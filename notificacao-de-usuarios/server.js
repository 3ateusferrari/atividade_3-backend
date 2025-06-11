const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
const PORTA = 3005;

app.use(cors());
app.use(express.json());

app.post('/notificacao/enviar', async (req, res) => {
    const { alarme_id, usuario_id, tipo, mensagem } = req.body;
    if (usuario_id) {
        try {
            const resposta = await axios.get(`http://localhost:3002/alarmes/${alarme_id}/permissao/${usuario_id}`);
            if (!resposta.data.autorizado) {
                return res.status(403).json({ erro: 'Usuário não tem permissão para receber notificação deste alarme' });
            }
        } catch {
            return res.status(403).json({ erro: 'Usuário não tem permissão para receber notificação deste alarme' });
        }
    }
    console.log(`[NOTIFICAÇÃO] Alarme: ${alarme_id} | Usuário: ${usuario_id || 'todos'} | Tipo: ${tipo} | Mensagem: ${mensagem}`);
    res.json({ status: 'enviada', alarme_id, usuario_id, tipo, mensagem });
});

app.get('/health', (req, res) => {
    res.json({ status: 'OK', servico: 'notificacao-usuarios', horario: new Date().toISOString() });
});

app.listen(PORTA, () => {
    console.log(`Serviço de Notificação de Usuários rodando na porta ${PORTA}`);
}); 