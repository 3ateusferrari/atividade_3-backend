const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const cors = require('cors');

const app = express();
const PORTA = 3000;

app.use(cors());
app.use(express.json());

app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
    next();
});

const servicos = {
    usuarios: 'http://localhost:3001',
    alarmes: 'http://localhost:3002',
    acionamento: 'http://localhost:3003',
    disparo: 'http://localhost:3004',
    notificacao: 'http://localhost:3005',
    logs: 'http://localhost:3006'
};

Object.keys(servicos).forEach(servico => {
    app.use(`/api/${servico}`, createProxyMiddleware({
        target: servicos[servico],
        changeOrigin: true,
        pathRewrite: {
            [`^/api/${servico}`]: ''
        },
        onError: (erro, req, res) => {
            console.error(`Erro de proxy para ${servico}:`, erro.message);
            res.status(503).json({ 
                erro: 'Serviço Indisponível', 
                mensagem: `O serviço ${servico} não está disponível` 
            });
        }
    }));
});

app.get('/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        horario: new Date().toISOString(),
        servicos: Object.keys(servicos)
    });
});

app.get('/', (req, res) => {
    res.json({
        mensagem: 'Sistema de Controle de Alarmes - API Gateway',
        versao: '1.0.0',
        endpoints: {
            usuarios: '/api/usuarios',
            alarmes: '/api/alarmes',
            acionamento: '/api/acionamento',
            disparo: '/api/disparo',
            notificacao: '/api/notificacao',
            logs: '/api/logs'
        }
    });
});

app.use((erro, req, res, next) => {
    console.error('Erro no gateway:', erro);
    res.status(500).json({ 
        erro: 'Erro Interno do Servidor',
        mensagem: 'Ocorreu um erro no gateway'
    });
});

app.listen(PORTA, () => {
    console.log(`API Gateway rodando na porta ${PORTA}`);
    console.log('Rotas disponíveis:');
    Object.keys(servicos).forEach(servico => {
        console.log(`  /api/${servico} -> ${servicos[servico]}`);
    });
});
