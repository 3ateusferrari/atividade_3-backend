const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const axios = require('axios');
const path = require('path');
const jwt = require('jsonwebtoken');

const app = express();
const PORTA = 3002;
const SECRET = process.env.JWT_SECRET || 'segredo_super_secreto';

app.use(express.json());

const caminhoBanco = path.join(__dirname, 'alarmes.db');
const banco = new sqlite3.Database(caminhoBanco);

banco.serialize(() => {
    banco.run(`CREATE TABLE IF NOT EXISTS alarmes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nome TEXT NOT NULL,
        local TEXT NOT NULL,
        data_instalacao DATETIME DEFAULT CURRENT_TIMESTAMP,
        status TEXT DEFAULT 'desligado'
    )`);
    
    banco.run(`CREATE TABLE IF NOT EXISTS alarme_usuarios (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        alarme_id INTEGER,
        usuario_id INTEGER,
        permissao TEXT DEFAULT 'usuario',
        data_vinculo DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(alarme_id) REFERENCES alarmes(id),
        UNIQUE(alarme_id, usuario_id)
    )`);
    
    banco.run(`CREATE TABLE IF NOT EXISTS pontos_monitorados (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        alarme_id INTEGER,
        nome TEXT NOT NULL,
        tipo TEXT NOT NULL,
        ativo BOOLEAN DEFAULT 1,
        FOREIGN KEY(alarme_id) REFERENCES alarmes(id)
    )`);
});

async function validarUsuario(idUsuario) {
    try {
        console.log(`[VALIDAÇÃO] Verificando usuário ID: ${idUsuario}`);
        const resposta = await axios.get(`http://localhost:3001/usuarios/${idUsuario}`, {
            timeout: 5000,
            headers: {
                'Content-Type': 'application/json'
            }
        });
        console.log(`[VALIDAÇÃO] Usuário ${idUsuario} encontrado:`, resposta.status === 200);
        return resposta.status === 200;
    } catch (erro) {
        console.error(`[VALIDAÇÃO] Erro ao validar usuário ${idUsuario}:`, erro.message);
        return false;
    }
}

function autenticarToken(req, res, next) {
    if (req.path === '/health') return next();
    
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    
    if (!token) {
        return res.status(401).json({ erro: 'Token não fornecido' });
    }
    
    jwt.verify(token, SECRET, (err, usuario) => {
        if (err) {
            console.error('[AUTH] Token inválido:', err.message);
            return res.status(403).json({ erro: 'Token inválido' });
        }
        console.log('[AUTH] Usuário autenticado:', usuario.id);
        req.usuario = usuario;
        next();
    });
}

app.use(autenticarToken);

function verificarVinculoUsuario(req, res, next) {
    const usuarioId = req.usuario.id;
    const alarmeId = req.params.id || req.body.alarme_id;
    
    if (!alarmeId) {
        return res.status(400).json({ erro: 'ID do alarme é obrigatório' });
    }
    
    const consulta = `SELECT * FROM alarme_usuarios WHERE alarme_id = ? AND usuario_id = ?`;
    banco.get(consulta, [alarmeId, usuarioId], (erro, vinculo) => {
        if (erro) {
            console.error('[VÍNCULO] Erro ao verificar vínculo:', erro);
            return res.status(500).json({ erro: 'Erro interno do servidor' });
        }
        if (!vinculo) {
            return res.status(403).json({ erro: 'Usuário não tem permissão para este alarme' });
        }
        console.log('[VÍNCULO] Usuário autorizado para alarme:', alarmeId);
        next();
    });
}

// Middleware para verificar se o usuário pode gerenciar o alarme (apenas para vincular outros usuários)
function verificarPermissaoGerencia(req, res, next) {
    const usuarioId = req.usuario.id;
    const alarmeId = req.params.id;
    
    const consulta = `SELECT permissao FROM alarme_usuarios WHERE alarme_id = ? AND usuario_id = ?`;
    banco.get(consulta, [alarmeId, usuarioId], (erro, vinculo) => {
        if (erro) {
            console.error('[PERMISSÃO] Erro ao verificar permissão:', erro);
            return res.status(500).json({ erro: 'Erro interno do servidor' });
        }
        
        if (!vinculo) {
            return res.status(403).json({ erro: 'Usuário não tem permissão para este alarme' });
        }
        
        if (vinculo.permissao !== 'admin' && vinculo.permissao !== 'gerente') {
            return res.status(403).json({ erro: 'Apenas administradores podem vincular outros usuários' });
        }
        
        console.log('[PERMISSÃO] Usuário autorizado a gerenciar alarme:', alarmeId);
        next();
    });
}

app.post('/alarmes', (req, res) => {
    const { nome, local } = req.body;
    const usuarioId = req.usuario.id;
    
    if (!nome || !local) {
        return res.status(400).json({ 
            erro: 'Nome e local são obrigatórios' 
        });
    }

    console.log(`[CREATE] Criando alarme para usuário ${usuarioId}:`, { nome, local });

    const consulta = `INSERT INTO alarmes (nome, local) VALUES (?, ?)`;
    
    banco.run(consulta, [nome, local], function(erro) {
        if (erro) {
            console.error('Erro ao criar alarme:', erro);
            return res.status(500).json({ 
                erro: 'Erro interno do servidor' 
            });
        }
        
        const alarmeId = this.lastID;
        
        // Vincula automaticamente o criador como administrador
        const consultaVinculo = `INSERT INTO alarme_usuarios (alarme_id, usuario_id, permissao) VALUES (?, ?, 'admin')`;
        
        banco.run(consultaVinculo, [alarmeId, usuarioId], function(erroVinculo) {
            if (erroVinculo) {
                console.error('Erro ao vincular criador do alarme:', erroVinculo);
            } else {
                console.log(`[CREATE] Usuário ${usuarioId} vinculado como admin do alarme ${alarmeId}`);
            }
            
            res.status(201).json({
                id: alarmeId,
                nome,
                local,
                status: 'desligado',
                mensagem: 'Alarme criado com sucesso'
            });
        });
    });
});

app.get('/alarmes', (req, res) => {
    const usuarioId = req.usuario.id;
    
    // Busca apenas alarmes que o usuário tem acesso
    const consulta = `
        SELECT a.* FROM alarmes a 
        INNER JOIN alarme_usuarios au ON a.id = au.alarme_id 
        WHERE au.usuario_id = ? 
        ORDER BY a.data_instalacao DESC
    `;
    
    banco.all(consulta, [usuarioId], (erro, linhas) => {
        if (erro) {
            console.error('Erro ao buscar alarmes:', erro);
            return res.status(500).json({ 
                erro: 'Erro interno do servidor' 
            });
        }
        
        console.log(`[GET] Retornando ${linhas.length} alarmes para usuário ${usuarioId}`);
        res.json(linhas);
    });
});

app.get('/alarmes/:id', verificarVinculoUsuario, (req, res) => {
    const { id } = req.params;
    const consulta = `SELECT * FROM alarmes WHERE id = ?`;
    
    banco.get(consulta, [id], (erro, linha) => {
        if (erro) {
            console.error('Erro ao buscar alarme:', erro);
            return res.status(500).json({ 
                erro: 'Erro interno do servidor' 
            });
        }
        
        if (!linha) {
            return res.status(404).json({ 
                erro: 'Alarme não encontrado' 
            });
        }
        
        res.json(linha);
    });
});

app.post('/alarmes/:id/usuarios', verificarPermissaoGerencia, async (req, res) => {
    const { id: idAlarme } = req.params;
    const { usuario_id, permissao = 'usuario' } = req.body;
    
    console.log(`[VINCULAR] Tentativa de vincular usuário ${usuario_id} ao alarme ${idAlarme}`);
    console.log(`[VINCULAR] Dados recebidos:`, req.body);
    
    if (!usuario_id) {
        return res.status(400).json({ 
            erro: 'ID do usuário é obrigatório' 
        });
    }

    // Valida se o usuário existe
    const usuarioExiste = await validarUsuario(usuario_id);
    if (!usuarioExiste) {
        return res.status(404).json({ 
            erro: 'Usuário não encontrado no sistema' 
        });
    }

    // Verifica se o alarme existe
    const consultaAlarme = `SELECT id FROM alarmes WHERE id = ?`;
    banco.get(consultaAlarme, [idAlarme], (erro, alarme) => {
        if (erro) {
            console.error('Erro ao verificar alarme:', erro);
            return res.status(500).json({ 
                erro: 'Erro interno do servidor' 
            });
        }
        
        if (!alarme) {
            return res.status(404).json({ 
                erro: 'Alarme não encontrado' 
            });
        }

        // Vincula o usuário ao alarme
        const consultaVinculo = `INSERT INTO alarme_usuarios (alarme_id, usuario_id, permissao) VALUES (?, ?, ?)`;
        
        banco.run(consultaVinculo, [idAlarme, usuario_id, permissao], function(erro) {
            if (erro) {
                if (erro.code === 'SQLITE_CONSTRAINT') {
                    console.log(`[VINCULAR] Tentativa de vínculo duplicado: alarme ${idAlarme}, usuário ${usuario_id}`);
                    return res.status(409).json({ 
                        erro: 'Usuário já vinculado a este alarme' 
                    });
                }
                console.error('Erro ao vincular usuário:', erro);
                return res.status(500).json({ 
                    erro: 'Erro interno do servidor' 
                });
            }
            
            console.log(`[VINCULAR] Sucesso: usuário ${usuario_id} vinculado ao alarme ${idAlarme} com permissão ${permissao}`);
            
            res.status(201).json({
                id: this.lastID,
                alarme_id: parseInt(idAlarme),
                usuario_id: parseInt(usuario_id),
                permissao,
                mensagem: 'Usuário vinculado ao alarme com sucesso'
            });
        });
    });
});

app.get('/alarmes/:id/usuarios', verificarVinculoUsuario, (req, res) => {
    const { id } = req.params;
    
    // Primeira consulta: buscar os vínculos
    const consulta = `SELECT * FROM alarme_usuarios WHERE alarme_id = ?`;
    
    banco.all(consulta, [id], async (erro, vinculos) => {
        if (erro) {
            console.error('Erro ao buscar usuários do alarme:', erro);
            return res.status(500).json({ 
                erro: 'Erro interno do servidor' 
            });
        }
        
        // Para cada vínculo, buscar dados do usuário
        const usuariosCompletos = [];
        
        for (const vinculo of vinculos) {
            try {
                const resposta = await axios.get(`http://localhost:3001/usuarios/${vinculo.usuario_id}`, {
                    timeout: 5000
                });
                
                usuariosCompletos.push({
                    ...vinculo,
                    nome: resposta.data.nome,
                    celular: resposta.data.celular
                });
            } catch (erro) {
                console.error(`Erro ao buscar dados do usuário ${vinculo.usuario_id}:`, erro.message);
                usuariosCompletos.push({
                    ...vinculo,
                    nome: 'Usuário não encontrado',
                    celular: null
                });
            }
        }
        
        res.json(usuariosCompletos);
    });
});

app.post('/alarmes/:id/pontos', verificarVinculoUsuario, (req, res) => {
    const { id: idAlarme } = req.params;
    const { nome, tipo } = req.body;
    
    if (!nome || !tipo) {
        return res.status(400).json({ 
            erro: 'Nome e tipo do ponto são obrigatórios' 
        });
    }

    const consultaAlarme = `SELECT id FROM alarmes WHERE id = ?`;
    banco.get(consultaAlarme, [idAlarme], (erro, alarme) => {
        if (erro) {
            console.error('Erro ao verificar alarme:', erro);
            return res.status(500).json({ 
                erro: 'Erro interno do servidor' 
            });
        }
        
        if (!alarme) {
            return res.status(404).json({ 
                erro: 'Alarme não encontrado' 
            });
        }

        const consultaPonto = `INSERT INTO pontos_monitorados (alarme_id, nome, tipo) VALUES (?, ?, ?)`;
        
        banco.run(consultaPonto, [idAlarme, nome, tipo], function(erro) {
            if (erro) {
                console.error('Erro ao adicionar ponto:', erro);
                return res.status(500).json({ 
                    erro: 'Erro interno do servidor' 
                });
            }
            
            res.status(201).json({
                id: this.lastID,
                alarme_id: parseInt(idAlarme),
                nome,
                tipo,
                ativo: true,
                mensagem: 'Ponto monitorado adicionado com sucesso'
            });
        });
    });
});

app.get('/alarmes/:id/pontos', verificarVinculoUsuario, (req, res) => {
    const { id } = req.params;
    const consulta = `SELECT * FROM pontos_monitorados WHERE alarme_id = ? ORDER BY nome`;
    
    banco.all(consulta, [id], (erro, linhas) => {
        if (erro) {
            console.error('Erro ao buscar pontos monitorados:', erro);
            return res.status(500).json({ 
                erro: 'Erro interno do servidor' 
            });
        }
        
        res.json(linhas);
    });
});

app.get('/alarmes/:id/permissao/:usuario_id', (req, res) => {
    const { id: idAlarme, usuario_id } = req.params;
    const consulta = `SELECT permissao FROM alarme_usuarios WHERE alarme_id = ? AND usuario_id = ?`;
    
    banco.get(consulta, [idAlarme, usuario_id], (erro, linha) => {
        if (erro) {
            console.error('Erro ao verificar permissão:', erro);
            return res.status(500).json({ 
                erro: 'Erro interno do servidor' 
            });
        }
        
        if (!linha) {
            return res.status(404).json({ 
                erro: 'Usuário não tem permissão para este alarme' 
            });
        }
        
        res.json({
            alarme_id: parseInt(idAlarme),
            usuario_id: parseInt(usuario_id),
            permissao: linha.permissao,
            autorizado: true
        });
    });
});

app.get('/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        servico: 'cadastro-alarmes',
        horario: new Date().toISOString() 
    });
});

app.use((erro, req, res, next) => {
    console.error('Erro no serviço de alarmes:', erro);
    if (!res.headersSent) {
        res.status(500).json({ 
            erro: 'Erro interno do servidor',
            mensagem: erro.message 
        });
    }
});

app.listen(PORTA, () => {
    console.log(`Serviço de Cadastro de Alarmes rodando na porta ${PORTA}`);
});

process.on('SIGINT', () => {
    console.log('Fechando conexão com o banco de dados...');
    banco.close((erro) => {
        if (erro) {
            console.error('Erro ao fechar banco:', erro);
        } else {
            console.log('Conexão com banco fechada.');
        }
        process.exit(0);
    });
});