const express = require('express');
const axios = require('axios');
const cors = require('cors');

const app = express();
const PORTA = 3003;

app.use(cors());
app.use(express.json());

const statusAlarmes = {};

app.post('/acionar/:id_alarme', async (req, res) => {
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

app.post('/desarmar/:id_alarme', async (req, res) => {
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