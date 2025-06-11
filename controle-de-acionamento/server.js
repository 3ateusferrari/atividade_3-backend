const express = require('express');
const axios = require('axios');
const cors = require('cors');
const jwt = require('jsonwebtoken');

const app = express();
const PORTA = 3003;
const SECRET = process.env.JWT_SECRET || 'segredo_super_secreto';

app.use(cors());
app.use(express.json());

const statusAlarmes = {};

function autenticarToken(req, res, next) {
    if (req.path === '/health') return next();
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return res.status(401).json({ erro: 'Token não fornecido' });
    jwt.verify(token, SECRET, (err, usuario) => {
        if (err) return res.status(403).json({ erro: 'Token inválido' });
        req.usuario = usuario;
        next();
    });
}

app.use(autenticarToken);

async function verificarVinculoUsuario(req, res, next) {
    const usuarioId = req.usuario.id;
    const alarmeId = req.params.id_alarme;
    try {
        const resposta = await axios.get(`http://localhost:3002/alarmes/${alarmeId}/permissao/${usuarioId}`);
        if (!resposta.data.autorizado) return res.status(403).json({ erro: 'Usuário não tem permissão para este alarme' });
        next();
    } catch {
        return res.status(403).json({ erro: 'Usuário não tem permissão para este alarme' });
    }
}

app.post('/acionar/:id_alarme', verificarVinculoUsuario, async (req, res) => {
    const { id_alarme } = req.params;
    try {
        const alarme = await axios.get(`http://localhost:3002/alarmes/${id_alarme}`);
        if (!alarme.data) {
            return res.status(404).json({ erro: 'Alarme não encontrado' });
        }
        statusAlarmes[id_alarme] = 'ligado';
        await axios.post('http://localhost:3006/logs', {
            alarme_id: id_alarme,
            tipo_evento: 'acionamento',
            detalhes: 'Alarme armado'
        });
        await axios.post('http://localhost:3005/notificacao/enviar', {
            alarme_id: id_alarme,
            tipo: 'acionamento',
            mensagem: 'O alarme foi armado.'
        });
        res.json({ id_alarme, situacao: 'ligado', mensagem: 'Alarme armado com sucesso' });
    } catch (erro) {
        res.status(500).json({ erro: 'Erro ao armar alarme' });
    }
});

app.post('/desarmar/:id_alarme', verificarVinculoUsuario, async (req, res) => {
    const { id_alarme } = req.params;
    try {
        const alarme = await axios.get(`http://localhost:3002/alarmes/${id_alarme}`);
        if (!alarme.data) {
            return res.status(404).json({ erro: 'Alarme não encontrado' });
        }
        statusAlarmes[id_alarme] = 'desligado';
        await axios.post('http://localhost:3006/logs', {
            alarme_id: id_alarme,
            tipo_evento: 'desligamento',
            detalhes: 'Alarme desarmado'
        });
        await axios.post('http://localhost:3005/notificacao/enviar', {
            alarme_id: id_alarme,
            tipo: 'desligamento',
            mensagem: 'O alarme foi desarmado.'
        });
        res.json({ id_alarme, situacao: 'desligado', mensagem: 'Alarme desarmado com sucesso' });
    } catch (erro) {
        res.status(500).json({ erro: 'Erro ao desarmar alarme' });
    }
});

app.get('/status/:id_alarme', (req, res) => {
    const { id_alarme } = req.params;
    const situacao = statusAlarmes[id_alarme] || 'desligado';
    res.json({ id_alarme, situacao });
});

app.get('/health', (req, res) => {
    res.json({ status: 'OK', servico: 'controle-acionamento', horario: new Date().toISOString() });
});

app.listen(PORTA, () => {
    console.log(`Serviço de Controle de Acionamento rodando na porta ${PORTA}`);
}); 