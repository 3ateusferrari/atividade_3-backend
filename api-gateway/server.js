const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const cors = require('cors');
const jwt = require('jsonwebtoken');

const app = express();
const PORTA = 3000;
const SECRET = process.env.JWT_SECRET || 'segredo_super_secreto';

app.use(cors());
app.use(express.json());

app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
    next();
});

function autenticarToken(req, res, next) {
    if (req.path === '/health' || req.path === '/') return next();
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return res.status(401).json({ erro: 'Token não fornecido' });
    jwt.verify(token, SECRET, (err, usuario) => {
        if (err) return res.status(403).json({ erro: 'Token inválido' });
        req.usuario = usuario;
        req.headers['x-usuario-id'] = usuario.id;
        next();
    });
}

app.use(autenticarToken);

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
