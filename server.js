const express = require('express');
const bodyParser = require('body-parser');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const path = require('path'); // Importa o módulo 'path'
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const app = express();
const port = 3000;

app.use(express.static('public'));


app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(session({
  secret: 'your-secret-key',
  resave: false,
  saveUninitialized: true,
  cookie: { secure: false } // Defina como true se estiver usando HTTPS
}));

// Middleware para verificar se o usuário está autenticado
const isAuthenticated = (req, res, next) => {
  if (req.session.userId) {
    next();
  } else {
    res.redirect('/login');
  }
};

// Rotas
app.get('/', (req, res) => {
  res.sendFile(__dirname + '/views/index.html');
});

app.get('/login', (req, res) => {
  res.sendFile(__dirname + '/views/login.html');
});

app.get('/register', (req, res) => {
  res.sendFile(__dirname + '/views/register.html');
});

app.get('/dashboard', isAuthenticated, (req, res) => {
  res.sendFile(__dirname + '/views/dashboard.html');
});

app.post('/register', async (req, res) => {
  const { username, password } = req.body;
  const hashedPassword = await bcrypt.hash(password, 10);

  try {
    const user = await prisma.user.create({
      data: {
        username,
        password: hashedPassword
      }
    });
    // Redireciona com uma mensagem de sucesso na URL
    res.redirect('/login?success=Usuário registrado com sucesso!');
  } catch (error) {
    // Redireciona com uma mensagem de erro na URL
    res.redirect('/register?error=Erro ao registrar usuário: Nome de usuário já existe');
  }
});

app.post('/login', async (req, res) => {
  const { username, password } = req.body;

  const user = await prisma.user.findUnique({
    where: { username }
  });

  if (user && await bcrypt.compare(password, user.password)) {
    req.session.userId = user.id;
    res.redirect('/dashboard');
  } else {
    // Redireciona com uma mensagem de erro na URL
    res.redirect('/login?error=Credenciais inválidas');
  }
});

app.get('/logout', isAuthenticated, (req, res) => {
  req.session.destroy(() => {
    res.redirect('/login');
  });
});

// Rota POST para adicionar item
app.post('/add-item', isAuthenticated, async (req, res) => {
  if (!req.session.userId) {
      return res.redirect('/login');
  }

  const { type, description, amount, installment, installmentCount } = req.body;

  try {
      // Salvar o item no banco de dados
      const newItem = await prisma.item.create({
          data: {
              type,
              description,
              amount: parseFloat(amount),
              installment: installment === 'sim',
              installmentCount: installment === 'sim' ? parseInt(installmentCount) : null,
              userId: req.session.userId // Associar o item ao usuário logado
          }
      });

      // Redireciona com uma mensagem de sucesso na URL
      res.redirect('/add-item?success=Item adicionado com sucesso!');
  } catch (error) {
      console.error('Erro ao adicionar item:', error);

      // Redireciona com uma mensagem de erro na URL
      res.redirect('/add-item?error=Erro ao adicionar item. Tente novamente.');
  }
});

// Rota para a página de adicionar item
app.get('/add-item',  isAuthenticated, (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'add-item.html'));
  });

  app.get('/dashboard-data', isAuthenticated, async (req, res) => {
    if (!req.session.userId) {
        return res.status(401).json({ error: 'Usuário não autenticado' });
    }

    try {
        // Recuperar todos os itens do usuário logado
        const items = await prisma.item.findMany({
            where: {
                userId: req.session.userId,
            },
        });

        // Calcular receitas, despesas, saídas e saldo
        let totalIncome = 0;      // Total de receitas
        let totalExpenses = 0;    // Total de despesas (dívidas)
        let totalOutflows = 0;    // Total de saídas

        items.forEach((item) => {
            if (item.type === 'entrada') {
                totalIncome += item.amount; // Soma as receitas
            } else if (item.type === 'divida') {
                totalExpenses += item.amount; // Soma as despesas (dívidas)
            } else if (item.type === 'saida') {
                totalOutflows += item.amount; // Soma as saídas
            }
        });

        const balance = totalIncome - totalExpenses - totalOutflows; // Saldo considerando receitas, despesas e saídas

        // Dados para o gráfico (agrupados por mês)
        const monthlyData = items.reduce((acc, item) => {
            const month = new Date(item.createdAt).toLocaleString('default', { month: 'short' });
            if (!acc[month]) {
                acc[month] = { income: 0, expenses: 0, outflows: 0 }; // Inicializa os valores do mês
            }
            if (item.type === 'entrada') {
                acc[month].income += item.amount; // Soma as receitas do mês
            } else if (item.type === 'divida') {
                acc[month].expenses += item.amount; // Soma as despesas (dívidas) do mês
            } else if (item.type === 'saida') {
                acc[month].outflows += item.amount; // Soma as saídas do mês
            }
            return acc;
        }, {});

        const labels = Object.keys(monthlyData); // Meses para o gráfico
        const incomeData = labels.map((month) => monthlyData[month].income); // Dados de receitas
        const expensesData = labels.map((month) => monthlyData[month].expenses); // Dados de despesas
        const outflowsData = labels.map((month) => monthlyData[month].outflows); // Dados de saídas

        // Retorna os dados para o frontend
        res.json({
            totalIncome,
            totalExpenses,
            totalOutflows, // Total de saídas
            balance,
            chartData: {
                labels,
                incomeData,
                expensesData,
                outflowsData, // Dados de saídas para o gráfico
            },
        });
    } catch (error) {
        console.error('Erro ao recuperar dados do dashboard:', error);
        res.status(500).json({ error: 'Erro ao recuperar dados do dashboard' });
    }
});

  // Rota para a página de dívidas
app.get('/dividas',  isAuthenticated, (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'dividas.html'));
});

app.get('/api/dividas',  isAuthenticated, async (req, res) => {
  try {
      console.log('Rota /api/dividas acessada');
      console.log('req.session.userId:', req.session.userId);

      const userId = parseInt(req.session.userId);
      if (!userId || isNaN(userId)) {
          return res.status(401).json({ error: 'Usuário não autenticado' });
      }

      // Buscar as dívidas na tabela Item
      const dividas = await prisma.item.findMany({
          where: {
              userId: userId,
              type: 'divida',
          },
      });

      console.log('Dívidas retornadas:', dividas);
      res.json(dividas);
  } catch (error) {
      console.error('Erro ao buscar dívidas:', error);
      res.status(500).json({ error: 'Erro ao buscar dívidas' });
  }
});

app.post('/api/dividas/:id/pagar-parcela', isAuthenticated, async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.session.userId;

        if (!userId) {
            return res.status(401).json({ error: 'Usuário não autenticado' });
        }

        const divida = await prisma.item.findUnique({
            where: { id: parseInt(id) },
        });

        if (!divida || divida.userId !== userId || divida.type !== 'divida') {
            return res.status(404).json({ error: 'Dívida não encontrada' });
        }

        if (divida.installmentCount <= 0) {
            return res.status(400).json({ error: 'Nenhuma parcela restante para pagar' });
        }

        // Atualizar a dívida (reduzir o valor e o número de parcelas)
        const valorParcela = divida.amount / divida.installmentCount;
        const updatedDivida = await prisma.item.update({
            where: { id: parseInt(id) },
            data: {
                amount: divida.amount - valorParcela,
                installmentCount: divida.installmentCount - 1,
            },
        });

        // Retorna uma mensagem de sucesso no JSON
        res.json({ success: 'Parcela paga com sucesso!', data: updatedDivida });
    } catch (error) {
        console.error('Erro ao pagar parcela:', error);
        res.status(500).json({ error: 'Erro ao pagar parcela' });
    }
});

// Rota para pagar uma dívida à vista
app.post('/api/dividas/:id/pagar-avista',  isAuthenticated, async (req, res) => {
  try {
      const { id } = req.params;
      const userId = req.session.userId;

      if (!userId) {
          return res.status(401).json({ error: 'Usuário não autenticado' });
      }

      const divida = await prisma.item.findUnique({
          where: { id: parseInt(id) },
      });

      if (!divida || divida.userId !== userId || divida.type !== 'divida') {
          return res.status(404).json({ error: 'Dívida não encontrada' });
      }

      // Deletar a dívida (pagamento à vista)
      await prisma.item.delete({
          where: { id: parseInt(id) },
      });

      res.json({ message: 'Dívida paga à vista com sucesso' });
  } catch (error) {
      console.error('Erro ao pagar à vista:', error);
      res.status(500).json({ error: 'Erro ao pagar à vista' });
  }
});

// Rota para deletar uma dívida
app.delete('/api/dividas/:id',  isAuthenticated, async (req, res) => {
  try {
      const { id } = req.params;
      const userId = req.session.userId;

      if (!userId) {
          return res.status(401).json({ error: 'Usuário não autenticado' });
      }

      const divida = await prisma.item.findUnique({
          where: { id: parseInt(id) },
      });

      if (!divida || divida.userId !== userId || divida.type !== 'divida') {
          return res.status(404).json({ error: 'Dívida não encontrada' });
      }

      // Deletar a dívida
      await prisma.item.delete({
          where: { id: parseInt(id) },
      });

      res.json({ message: 'Dívida deletada com sucesso' });
  } catch (error) {
      console.error('Erro ao deletar dívida:', error);
      res.status(500).json({ error: 'Erro ao deletar dívida' });
  }
});

// Rota para listar todas as receitas do usuário logado
app.get('/api/receitas',  isAuthenticated, async (req, res) => {
  try {
      console.log('Rota /api/receitas acessada');
      console.log('req.session.userId:', req.session.userId);

      const userId = req.session.userId;
      if (!userId) {
          return res.status(401).json({ error: 'Usuário não autenticado' });
      }

      const receitas = await prisma.item.findMany({
          where: {
              userId: userId,
              type: 'entrada',
          },
      });

      console.log('Receitas retornadas:', receitas);
      res.json(receitas);
  } catch (error) {
      console.error('Erro ao buscar receitas:', error);
      res.status(500).json({ error: 'Erro ao buscar receitas' });
  }
});

// Rota para deletar uma receita
app.delete('/api/receitas/:id', isAuthenticated, async (req, res) => {
  try {
      const { id } = req.params;
      const userId = req.session.userId;

      if (!userId) {
          return res.status(401).json({ error: 'Usuário não autenticado' });
      }

      const receita = await prisma.item.findUnique({
          where: {
              id: parseInt(id),
              type: 'entrada',
          },
      });

      if (!receita || receita.userId !== userId) {
          return res.status(404).json({ error: 'Receita não encontrada' });
      }

      // Deletar a receita
      await prisma.item.delete({
          where: { id: parseInt(id) },
      });

      res.json({ message: 'Receita deletada com sucesso' });
  } catch (error) {
      console.error('Erro ao deletar receita:', error);
      res.status(500).json({ error: 'Erro ao deletar receita' });
  }
});

// Rota para listar todas as saídas do usuário logado
app.get('/api/saidas',  isAuthenticated, async (req, res) => {
  try {
      const userId = req.session.userId; // Supondo que o ID do usuário está na sessão
      if (!userId) {
          return res.status(401).json({ error: 'Usuário não autenticado' });
      }

      const saidas = await prisma.item.findMany({
          where: {
              userId: userId,
              type: 'saida',
          },
      });

      res.json(saidas);
  } catch (error) {
      console.error('Erro ao buscar saídas:', error);
      res.status(500).json({ error: 'Erro ao buscar saídas' });
  }
});

// Rota para deletar uma saída
app.delete('/api/saidas/:id',  isAuthenticated, async (req, res) => {
  try {
      const { id } = req.params;
      const userId = req.session.userId;

      if (!userId) {
          return res.status(401).json({ error: 'Usuário não autenticado' });
      }

      const saida = await prisma.item.findUnique({
          where: {
              id: parseInt(id),
              type: 'saida',
          },
      });

      if (!saida || saida.userId !== userId) {
          return res.status(404).json({ error: 'Saída não encontrada' });
      }

      // Deletar a saída
      await prisma.item.delete({
          where: { id: parseInt(id) },
      });

      res.json({ message: 'Saída deletada com sucesso' });
  } catch (error) {
      console.error('Erro ao deletar saída:', error);
      res.status(500).json({ error: 'Erro ao deletar saída' });
  }
});

// Rota para servir a página de saídas
app.get('/saidas',  isAuthenticated, (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'saidas.html'));
});

// Rota para servir a página de receitas
app.get('/receitas', isAuthenticated, (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'receitas.html'));
});

// Rota GET para buscar uma entrada por ID
app.get('/api/receitas/:id', isAuthenticated, async (req, res) => {
  try {
      const { id } = req.params;
      const userId = req.session.userId;

      const entrada = await prisma.item.findUnique({
          where: {
              id: parseInt(id),
              type: 'entrada', // Alterado para 'entrada'
              userId: userId,
          },
      });

      if (!entrada) {
          return res.status(404).send('Entrada não encontrada'); // Mensagem de erro corrigida
      }

      res.json(entrada);
  } catch (error) {
      console.error('Erro ao buscar entrada:', error);
      res.status(500).send('Erro ao buscar entrada');
  }
});

// Rota PUT para atualizar uma entrada por ID
app.put('/api/receitas/:id', isAuthenticated, async (req, res) => {
  try {
      const { id } = req.params;
      const userId = req.session.userId;
      const { description, amount } = req.body;

      const entrada = await prisma.item.findUnique({
          where: {
              id: parseInt(id),
              type: 'entrada', // Alterado para 'entrada'
              userId: userId,
          },
      });

      if (!entrada) {
          return res.status(404).send('Entrada não encontrada'); // Mensagem de erro corrigida
      }

      await prisma.item.update({
          where: { id: parseInt(id) },
          data: { description, amount: parseFloat(amount) },
      });

      res.json({ message: 'Entrada atualizada com sucesso' }); // Mensagem de sucesso corrigida
  } catch (error) {
      console.error('Erro ao atualizar entrada:', error);
      res.status(500).send('Erro ao atualizar entrada');
  }
});

app.get('/editar-receita/:id', isAuthenticated, async (req, res) => {
  try {
      const { id } = req.params;
      const userId = req.session.userId;

      const receita = await prisma.item.findUnique({
          where: {
              id: parseInt(id),
              type: 'entrada',
          },
      });

      if (!receita || receita.userId !== userId) {
          return res.status(404).send('Receita não encontrada');
      }

      // Renderizar a página de edição com os dados da receita
      res.sendFile(path.join(__dirname, 'views', 'editar-receita.html'));
  } catch (error) {
      console.error('Erro ao buscar receita para edição:', error);
      res.status(500).send('Erro ao buscar receita para edição');
  }
});

// Rota GET para buscar uma saída por ID
app.get('/editar-saida/:id', isAuthenticated, async (req, res) => {
  try {
      const { id } = req.params;
      const userId = req.session.userId;

      const saida = await prisma.item.findUnique({
          where: {
              id: parseInt(id),
              type: 'saida',
              userId: userId,
          },
      });

      if (!saida) {
          return res.status(404).send('Saída não encontrada');
      }

      res.sendFile(path.join(__dirname, 'views', 'editar-saida.html'));
  } catch (error) {
      console.error('Erro ao buscar saída:', error);
      res.status(500).send('Erro ao buscar saída');
  }
});

// Rota GET para buscar dados da saída para edição (API)
app.get('/api/saidas/:id', isAuthenticated, async (req, res) => {
  try {
      const { id } = req.params;
      const userId = req.session.userId;

      const saida = await prisma.item.findUnique({
          where: {
              id: parseInt(id),
              type: 'saida',
              userId: userId,
          },
      });

      if (!saida) {
          return res.status(404).send('Saída não encontrada');
      }

      res.json(saida);
  } catch (error) {
      console.error('Erro ao buscar saída:', error);
      res.status(500).send('Erro ao buscar saída');
  }
});

// Rota PUT para atualizar uma saída por ID (API)
app.put('/api/saidas/:id', isAuthenticated, async (req, res) => {
  try {
      const { id } = req.params;
      const userId = req.session.userId;
      const { description, amount } = req.body;

      const saida = await prisma.item.findUnique({
          where: {
              id: parseInt(id),
              type: 'saida',
              userId: userId,
          },
      });

      if (!saida) {
          return res.status(404).send('Saída não encontrada');
      }

      await prisma.item.update({
          where: { id: parseInt(id) },
          data: { description, amount: parseFloat(amount) },
      });

      res.json({ message: 'Saída atualizada com sucesso' });
  } catch (error) {
      console.error('Erro ao atualizar saída:', error);
      res.status(500).send('Erro ao atualizar saída');
  }
});
// Rota para a página de recibo
app.get('/recibo', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'recibo.html'));
});

app.listen(port, () => {
  console.log(`Servidor rodando em http://localhost:${port}`);
});