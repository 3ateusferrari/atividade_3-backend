const express = require('express');
const axios = require('axios');
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
    if (
        req.path === '/health' || 
        req.path === '/' || 
        (req.path === '/api/usuarios/login') ||
        (req.path === '/api/usuarios/usuarios' && req.method === 'POST')
    ) {
        return next();
    }
    
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

// Headers que devem ser removidos ao fazer proxy
const HEADERS_PARA_REMOVER = [
    'host',
    'connection',
    'content-length',
    'transfer-encoding',
    'upgrade',
    'proxy-connection',
    'proxy-authenticate',
    'proxy-authorization',
    'te',
    'trailers'
];

function limparHeaders(headers) {
    const headersLimpos = { ...headers };
    HEADERS_PARA_REMOVER.forEach(header => {
        delete headersLimpos[header];
        delete headersLimpos[header.toLowerCase()];
    });
    return headersLimpos;
}

async function proxyRequest(req, res, servico) {
    try {
        const targetUrl = servicos[servico];
        const path = req.path.replace(`/api/${servico}`, '');
        const url = `${targetUrl}${path}`;
        
        console.log(`[PROXY] ${req.method} ${req.url} -> ${url}`);
        console.log(`[PROXY] Body:`, req.body);
        console.log(`[PROXY] Query:`, req.query);
        
        // Headers limpos - sem headers problemáticos
        const headersLimpos = limparHeaders(req.headers);
        
        const config = {
            method: req.method.toLowerCase(),
            url: url,
            headers: headersLimpos,
            timeout: 30000,
            validateStatus: function (status) {
                return status < 600; // Aceita qualquer status < 600
            }
        };
        
        // Adiciona dados para métodos que permitem body
        if (['post', 'put', 'patch'].includes(req.method.toLowerCase()) && req.body) {
            config.data = req.body;
            config.headers['content-type'] = 'application/json';
        }
        
        // Adiciona query parameters
        if (Object.keys(req.query).length > 0) {
            config.params = req.query;
        }
        
        console.log(`[PROXY] Config final:`, {
            method: config.method,
            url: config.url,
            headers: config.headers,
            hasData: !!config.data,
            params: config.params
        });
        
        const response = await axios(config);
        console.log(`[PROXY] Resposta: ${response.status} para ${req.url}`);
        console.log(`[PROXY] Dados da resposta:`, response.data);
        
        // Copia apenas headers seguros da resposta
        const headersSeguros = ['content-type', 'cache-control', 'expires', 'last-modified', 'etag'];
        headersSeguros.forEach(header => {
            if (response.headers[header]) {
                res.set(header, response.headers[header]);
            }
        });
        
        res.status(response.status).json(response.data);
        
    } catch (error) {
        console.error(`[PROXY] Erro detalhado para ${servico}:`, {
            message: error.message,
            code: error.code,
            status: error.response?.status,
            data: error.response?.data,
            config: {
                method: error.config?.method,
                url: error.config?.url,
                timeout: error.config?.timeout
            }
        });
        
        if (error.response) {
            // Erro HTTP do serviço de destino
            res.status(error.response.status).json(error.response.data);
        } else if (error.code === 'ECONNREFUSED') {
            // Serviço não está disponível
            res.status(503).json({ 
                erro: 'Serviço Indisponível', 
                mensagem: `O serviço ${servico} não está disponível`,
                detalhes: `Não foi possível conectar com ${servicos[servico]}`
            });
        } else if (error.code === 'ECONNABORTED') {
            // Timeout
            res.status(504).json({ 
                erro: 'Timeout do Gateway',
                mensagem: `O serviço ${servico} não respondeu dentro do tempo limite`,
                timeout: '30 segundos'
            });
        } else {
            // Outros erros
            res.status(500).json({ 
                erro: 'Erro Interno do Gateway',
                mensagem: error.message,
                codigo: error.code
            });
        }
    }
}

// Configuração das rotas dos serviços
Object.keys(servicos).forEach(servico => {
    app.use(`/api/${servico}`, (req, res) => {
        proxyRequest(req, res, servico);
    });
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

// Middleware de tratamento de erros
app.use((erro, req, res, next) => {
    console.error('[GATEWAY] Erro não capturado:', erro);
    if (!res.headersSent) {
        res.status(500).json({ 
            erro: 'Erro Interno do Servidor',
            mensagem: 'Ocorreu um erro no gateway',
            detalhes: erro.message
        });
    }
});

app.listen(PORTA, () => {
    console.log(`API Gateway rodando na porta ${PORTA}`);
    console.log('Rotas disponíveis:');
    Object.keys(servicos).forEach(servico => {
        console.log(`  /api/${servico} -> ${servicos[servico]}`);
    });
    
    // Teste de conectividade com os serviços
    console.log('\nTestando conectividade com os serviços...');
    Object.entries(servicos).forEach(async ([nome, url]) => {
        try {
            await axios.get(`${url}/health`, { timeout: 5000 });
            console.log(`✅ ${nome} (${url}) - ONLINE`);
        } catch (error) {
            console.log(`❌ ${nome} (${url}) - OFFLINE (${error.message})`);
        }
    });
});