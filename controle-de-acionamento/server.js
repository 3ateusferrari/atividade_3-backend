const express = require('express');
const axios = require('axios');
const cors = require('cors');

const app = express();
const PORT = 3003;

app.use(cors());
app.use(express.json());

const alarmesStatus = {};

app.post('/acionar/:alarme_id', async (req, res) => {
    const { alarme_id } = req.params;
    try {
        const alarme = await axios.get(`http://localhost:3002/alarmes/${alarme_id}`);
        if (!alarme.data) {
            return res.status(404).json({ error: 'Alarme não encontrado' });
        }
        alarmesStatus[alarme_id] = 'ligado';
        await axios.post('http://localhost:3006/logs', {
            alarme_id,
            tipo_evento: 'acionamento',
            detalhes: 'Alarme armado'
        });
        await axios.post('http://localhost:3005/notificacao/enviar', {
            alarme_id,
            tipo: 'acionamento',
            mensagem: 'O alarme foi armado.'
        });
        res.json({ alarme_id, status: 'ligado', message: 'Alarme armado com sucesso' });
    } catch (err) {
        res.status(500).json({ error: 'Erro ao armar alarme' });
    }
});

app.post('/desarmar/:alarme_id', async (req, res) => {
    const { alarme_id } = req.params;
    try {
        const alarme = await axios.get(`http://localhost:3002/alarmes/${alarme_id}`);
        if (!alarme.data) {
            return res.status(404).json({ error: 'Alarme não encontrado' });
        }
        alarmesStatus[alarme_id] = 'desligado';
        await axios.post('http://localhost:3006/logs', {
            alarme_id,
            tipo_evento: 'desligamento',
            detalhes: 'Alarme desarmado'
        });
        await axios.post('http://localhost:3005/notificacao/enviar', {
            alarme_id,
            tipo: 'desligamento',
            mensagem: 'O alarme foi desarmado.'
        });
        res.json({ alarme_id, status: 'desligado', message: 'Alarme desarmado com sucesso' });
    } catch (err) {
        res.status(500).json({ error: 'Erro ao desarmar alarme' });
    }
});

app.get('/status/:alarme_id', (req, res) => {
    const { alarme_id } = req.params;
    const status = alarmesStatus[alarme_id] || 'desligado';
    res.json({ alarme_id, status });
});

app.get('/health', (req, res) => {
    res.json({ status: 'OK', service: 'controle-acionamento', timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
    console.log(`Serviço de Controle de Acionamento rodando na porta ${PORT}`);
}); 