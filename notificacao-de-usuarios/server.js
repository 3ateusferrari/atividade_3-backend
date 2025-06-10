const express = require('express');
const cors = require('cors');

const app = express();
const PORTA = 3005;

app.use(cors());
app.use(express.json());

app.post('/notificacao/enviar', (req, res) => {
    const { alarme_id, usuario_id, tipo, mensagem } = req.body;
    console.log(`[NOTIFICAÇÃO] Alarme: ${alarme_id} | Usuário: ${usuario_id || 'todos'} | Tipo: ${tipo} | Mensagem: ${mensagem}`);
    res.json({ status: 'enviada', alarme_id, usuario_id, tipo, mensagem });
});

app.get('/health', (req, res) => {
    res.json({ status: 'OK', servico: 'notificacao-usuarios', horario: new Date().toISOString() });
});

app.listen(PORTA, () => {
    console.log(`Serviço de Notificação de Usuários rodando na porta ${PORTA}`);
}); 