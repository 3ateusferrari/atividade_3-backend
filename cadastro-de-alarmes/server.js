const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const axios = require('axios');
const path = require('path');

const app = express();
const PORT = 3002;

app.use(express.json());

const dbPath = path.join(__dirname, 'alarmes.db');
const db = new sqlite3.Database(dbPath);

db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS alarmes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nome TEXT NOT NULL,
        local TEXT NOT NULL,
        data_instalacao DATETIME DEFAULT CURRENT_TIMESTAMP,
        status TEXT DEFAULT 'desligado'
    )`);
    
    db.run(`CREATE TABLE IF NOT EXISTS alarme_usuarios (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        alarme_id INTEGER,
        usuario_id INTEGER,
        permissao TEXT DEFAULT 'usuario',
        data_vinculo DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(alarme_id) REFERENCES alarmes(id),
        UNIQUE(alarme_id, usuario_id)
    )`);
    
    db.run(`CREATE TABLE IF NOT EXISTS pontos_monitorados (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        alarme_id INTEGER,
        nome TEXT NOT NULL,
        tipo TEXT NOT NULL,
        ativo BOOLEAN DEFAULT 1,
        FOREIGN KEY(alarme_id) REFERENCES alarmes(id)
    )`);
});

async function validateUser(userId) {
    try {
        const response = await axios.get(`http://localhost:3001/usuarios/${userId}`);
        return response.status === 200;
    } catch (error) {
        return false;
    }
}

app.post('/alarmes', (req, res) => {
    const { nome, local } = req.body;
    
    if (!nome || !local) {
        return res.status(400).json({ 
            error: 'Nome e local são obrigatórios' 
        });
    }

    const query = `INSERT INTO alarmes (nome, local) VALUES (?, ?)`;
    
    db.run(query, [nome, local], function(err) {
        if (err) {
            console.error('Erro ao criar alarme:', err);
            return res.status(500).json({ 
                error: 'Erro interno do servidor' 
            });
        }
        
        res.status(201).json({
            id: this.lastID,
            nome,
            local,
            status: 'desligado',
            message: 'Alarme criado com sucesso'
        });
    });
});

app.get('/alarmes', (req, res) => {
    const query = `SELECT * FROM alarmes ORDER BY data_instalacao DESC`;
    
    db.all(query, [], (err, rows) => {
        if (err) {
            console.error('Erro ao buscar alarmes:', err);
            return res.status(500).json({ 
                error: 'Erro interno do servidor' 
            });
        }
        
        res.json(rows);
    });
});

app.get('/alarmes/:id', (req, res) => {
    const { id } = req.params;
    const query = `SELECT * FROM alarmes WHERE id = ?`;
    
    db.get(query, [id], (err, row) => {
        if (err) {
            console.error('Erro ao buscar alarme:', err);
            return res.status(500).json({ 
                error: 'Erro interno do servidor' 
            });
        }
        
        if (!row) {
            return res.status(404).json({ 
                error: 'Alarme não encontrado' 
            });
        }
        
        res.json(row);
    });
});

app.post('/alarmes/:id/usuarios', async (req, res) => {
    const { id: alarmeId } = req.params;
    const { usuario_id, permissao = 'usuario' } = req.body;
    
    if (!usuario_id) {
        return res.status(400).json({ 
            error: 'ID do usuário é obrigatório' 
        });
    }

    const userExists = await validateUser(usuario_id);
    if (!userExists) {
        return res.status(404).json({ 
            error: 'Usuário não encontrado' 
        });
    }

    const checkAlarmQuery = `SELECT id FROM alarmes WHERE id = ?`;
    db.get(checkAlarmQuery, [alarmeId], (err, alarm) => {
        if (err) {
            console.error('Erro ao verificar alarme:', err);
            return res.status(500).json({ 
                error: 'Erro interno do servidor' 
            });
        }
        
        if (!alarm) {
            return res.status(404).json({ 
                error: 'Alarme não encontrado' 
            });
        }

        const linkQuery = `INSERT INTO alarme_usuarios (alarme_id, usuario_id, permissao) VALUES (?, ?, ?)`;
        
        db.run(linkQuery, [alarmeId, usuario_id, permissao], function(err) {
            if (err) {
                if (err.code === 'SQLITE_CONSTRAINT') {
                    return res.status(409).json({ 
                        error: 'Usuário já vinculado a este alarme' 
                    });
                }
                console.error('Erro ao vincular usuário:', err);
                return res.status(500).json({ 
                    error: 'Erro interno do servidor' 
                });
            }
            
            res.status(201).json({
                id: this.lastID,
                alarme_id: parseInt(alarmeId),
                usuario_id: parseInt(usuario_id),
                permissao,
                message: 'Usuário vinculado ao alarme com sucesso'
            });
        });
    });
});

app.get('/alarmes/:id/usuarios', (req, res) => {
    const { id } = req.params;
    const query = `SELECT au.*, u.nome, u.celular 
                   FROM alarme_usuarios au 
                   LEFT JOIN usuarios u ON au.usuario_id = u.id 
                   WHERE au.alarme_id = ?`;
    
    db.all(query, [id], (err, rows) => {
        if (err) {
            console.error('Erro ao buscar usuários do alarme:', err);
            return res.status(500).json({ 
                error: 'Erro interno do servidor' 
            });
        }
        
        res.json(rows);
    });
});

app.post('/alarmes/:id/pontos', (req, res) => {
    const { id: alarmeId } = req.params;
    const { nome, tipo } = req.body;
    
    if (!nome || !tipo) {
        return res.status(400).json({ 
            error: 'Nome e tipo do ponto são obrigatórios' 
        });
    }

    const checkAlarmQuery = `SELECT id FROM alarmes WHERE id = ?`;
    db.get(checkAlarmQuery, [alarmeId], (err, alarm) => {
        if (err) {
            console.error('Erro ao verificar alarme:', err);
            return res.status(500).json({ 
                error: 'Erro interno do servidor' 
            });
        }
        
        if (!alarm) {
            return res.status(404).json({ 
                error: 'Alarme não encontrado' 
            });
        }

        const insertQuery = `INSERT INTO pontos_monitorados (alarme_id, nome, tipo) VALUES (?, ?, ?)`;
        
        db.run(insertQuery, [alarmeId, nome, tipo], function(err) {
            if (err) {
                console.error('Erro ao adicionar ponto:', err);
                return res.status(500).json({ 
                    error: 'Erro interno do servidor' 
                });
            }
            
            res.status(201).json({
                id: this.lastID,
                alarme_id: parseInt(alarmeId),
                nome,
                tipo,
                ativo: true,
                message: 'Ponto monitorado adicionado com sucesso'
            });
        });
    });
});

app.get('/alarmes/:id/pontos', (req, res) => {
    const { id } = req.params;
    const query = `SELECT * FROM pontos_monitorados WHERE alarme_id = ? ORDER BY nome`;
    
    db.all(query, [id], (err, rows) => {
        if (err) {
            console.error('Erro ao buscar pontos monitorados:', err);
            return res.status(500).json({ 
                error: 'Erro interno do servidor' 
            });
        }
        
        res.json(rows);
    });
});

app.get('/alarmes/:id/permissao/:usuario_id', (req, res) => {
    const { id: alarmeId, usuario_id } = req.params;
    const query = `SELECT permissao FROM alarme_usuarios WHERE alarme_id = ? AND usuario_id = ?`;
    
    db.get(query, [alarmeId, usuario_id], (err, row) => {
        if (err) {
            console.error('Erro ao verificar permissão:', err);
            return res.status(500).json({ 
                error: 'Erro interno do servidor' 
            });
        }
        
        if (!row) {
            return res.status(404).json({ 
                error: 'Usuário não tem permissão para este alarme' 
            });
        }
        
        res.json({
            alarme_id: parseInt(alarmeId),
            usuario_id: parseInt(usuario_id),
            permissao: row.permissao,
            autorizado: true
        });
    });
});

app.get('/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        service: 'cadastro-alarmes',
        timestamp: new Date().toISOString() 
    });
});

app.use((err, req, res, next) => {
    console.error('Erro no serviço de alarmes:', err);
    res.status(500).json({ 
        error: 'Erro interno do servidor' 
    });
});

app.listen(PORT, () => {
    console.log(`Serviço de Cadastro de Alarmes rodando na porta ${PORT}`);
});

process.on('SIGINT', () => {
    console.log('Fechando conexão com o banco de dados...');
    db.close((err) => {
        if (err) {
            console.error('Erro ao fechar banco:', err);
        } else {
            console.log('Conexão com banco fechada.');
        }
        process.exit(0);
    });
});
