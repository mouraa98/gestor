const express = require('express');
const bodyParser = require('body-parser');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const cors = require('cors');
const path = require('path'); // Importa o módulo 'path'
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const app = express();
const port = 8000;

app.use(express.static('public'));

app.use(cors());
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

// Rota para pagamento avulso de parcela
app.post('/api/dividas/:id/pagar-avulso', isAuthenticated, async (req, res) => {
  const { id } = req.params;
  const { valorPago, numeroParcela } = req.body;

  try {
    // Verifica se a dívida existe
    const divida = await prisma.item.findUnique({
      where: { id: parseInt(id) },
      include: { parcelasPagas: true }
    });

    if (!divida) {
      return res.status(404).json({ error: 'Dívida não encontrada' });
    }

    // Verifica se o valor é válido
    if (!valorPago || valorPago <= 0) {
      return res.status(400).json({ error: 'Valor inválido para pagamento' });
    }

    // Verifica se o número da parcela é válido
    if (!numeroParcela || numeroParcela <= 0) {
      return res.status(400).json({ error: 'Número de parcela inválido' });
    }

    // Registra o pagamento avulso
    const parcelaPaga = await prisma.parcelaPaga.create({
      data: {
        itemId: divida.id,
        valorPago: parseFloat(valorPago),
        numeroParcela: parseInt(numeroParcela),
        dataPagamento: new Date()
      }
    });

    // Atualiza o valor total pago na dívida
    const totalPago = divida.parcelasPagas.reduce((sum, parcela) => sum + parcela.valorPago, 0) + parseFloat(valorPago);
    
    await prisma.item.update({
      where: { id: divida.id },
      data: {
        valorPago: totalPago,
        status: totalPago >= divida.amount ? 'paga' : divida.status
      }
    });

    res.json({ success: true, parcelaPaga });
  } catch (error) {
    console.error('Erro ao processar pagamento avulso:', error);
    res.status(500).json({ error: 'Erro ao processar pagamento avulso' });
  }
});

app.get('/logout', isAuthenticated, (req, res) => {
  req.session.destroy(() => {
    res.redirect('/login');
  });
});

// Rota POST para adicionar item
app.post('/add-item', isAuthenticated, async (req, res) => {
  try {
    const { type, description, amount, installment, installmentCount } = req.body;
    
    let valorParcela = null;
    if (type === 'divida' && installment === 'sim' && installmentCount) {
      valorParcela = parseFloat(amount) / parseInt(installmentCount);
    }

    const newItem = await prisma.item.create({
      data: {
        type,
        description,
        amount: parseFloat(amount),
        installment: installment === 'sim',
        installmentCount: installment === 'sim' ? parseInt(installmentCount) : null,
        valorParcela: valorParcela, // Armazena o valor FIXO
        userId: req.session.userId
      }
    });

    res.redirect('/add-item?success=Item adicionado com sucesso!');
  } catch (error) {
    res.redirect('/add-item?error=Erro ao adicionar item');
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
        // Recuperar todos os itens do usuário logado, incluindo as parcelas pagas
        const items = await prisma.item.findMany({
            where: {
                userId: req.session.userId,
            },
            include: {
                parcelasPagas: true, // Incluir as parcelas pagas
            },
        });

        // Inicializar totais
        let totalIncome = 0;      // Total de receitas
        let totalOutflows = 0;    // Total de saídas
        let totalParcelasPagas = 0; // Total de parcelas pagas
        let totalExpenses = 0;    // Total de despesas (dívidas pendentes)

        // Processar cada item
        items.forEach((item) => {
            if (item.type === 'entrada') {
                // Soma as receitas
                totalIncome += item.amount;
            } else if (item.type === 'saida') {
                // Soma as saídas
                totalOutflows += item.amount;
            } else if (item.type === 'divida' && item.status !== 'paga') {
                // Soma as despesas (dívidas pendentes)
                if (item.installment) {
                    // Se for parcelada, soma apenas o valor das parcelas pendentes
                    const totalParcelas = item.installmentCount || 0;
                    const parcelasPagas = item.parcelasPagas.length;
                    const valorPorParcela = item.amount / totalParcelas;
                    const parcelasPendentes = totalParcelas - parcelasPagas;

                    totalExpenses += valorPorParcela * parcelasPendentes;
                } else {
                    // Se não for parcelada, soma o valor total da dívida
                    totalExpenses += item.amount;
                }
            }

            // Soma o valor das parcelas pagas
            if (item.parcelasPagas && item.parcelasPagas.length > 0) {
                item.parcelasPagas.forEach((parcela) => {
                    totalParcelasPagas += parcela.valorPago;
                });
            }
        });

        // Calcular o saldo (apenas entradas - saídas - parcelas pagas)
        const balance = totalIncome - totalOutflows - totalParcelasPagas;

        // Dados para o gráfico (agrupados por mês)
        const monthlyData = items.reduce((acc, item) => {
            const month = new Date(item.createdAt).toLocaleString('default', { month: 'short' });
            if (!acc[month]) {
                acc[month] = { income: 0, expenses: 0, outflows: 0, parcelasPagas: 0 }; // Inicializa os valores do mês
            }

            if (item.type === 'entrada') {
                acc[month].income += item.amount; // Soma as receitas do mês
            } else if (item.type === 'saida') {
                acc[month].outflows += item.amount; // Soma as saídas do mês
            } else if (item.type === 'divida' && item.status !== 'paga') {
                // Soma as despesas (dívidas) do mês, apenas se não estiverem pagas
                if (item.installment) {
                    // Se for parcelada, soma apenas o valor das parcelas pendentes
                    const totalParcelas = item.installmentCount || 0;
                    const parcelasPagas = item.parcelasPagas.length;
                    const valorPorParcela = item.amount / totalParcelas;
                    const parcelasPendentes = totalParcelas - parcelasPagas;

                    acc[month].expenses += valorPorParcela * parcelasPendentes;
                } else {
                    // Se não for parcelada, soma o valor total da dívida
                    acc[month].expenses += item.amount;
                }
            }

            // Soma o valor das parcelas pagas no mês
            if (item.parcelasPagas && item.parcelasPagas.length > 0) {
                item.parcelasPagas.forEach((parcela) => {
                    const parcelaMonth = new Date(parcela.dataPagamento).toLocaleString('default', { month: 'short' });
                    if (parcelaMonth === month) {
                        acc[month].parcelasPagas += parcela.valorPago;
                    }
                });
            }

            return acc;
        }, {});

        const labels = Object.keys(monthlyData); // Meses para o gráfico
        const incomeData = labels.map((month) => monthlyData[month].income); // Dados de receitas
        const expensesData = labels.map((month) => monthlyData[month].expenses); // Dados de despesas
        const outflowsData = labels.map((month) => monthlyData[month].outflows); // Dados de saídas
        const parcelasPagasData = labels.map((month) => monthlyData[month].parcelasPagas); // Dados de parcelas pagas

        // Retorna os dados para o frontend
        res.json({
            totalIncome,
            totalOutflows,
            totalParcelasPagas, // Total de parcelas pagas
            totalExpenses, // Total de despesas (dívidas pendentes)
            balance,
            chartData: {
                labels,
                incomeData,
                expensesData, // Dados de despesas para o gráfico
                outflowsData,
                parcelasPagasData, // Dados de parcelas pagas para o gráfico
            },
            items, // Incluir os itens com as parcelas pagas
        });
    } catch (error) {
        console.error('Erro ao recuperar dados do dashboard:', error);
        res.status(500).json({ error: 'Erro ao recuperar dados do dashboard' });
    }
});

app.post('/pagar-parcela', isAuthenticated, async (req, res) => {
  const { itemId, valorPago } = req.body;

  try {
      // Busca o saldo atual
      const dashboardResponse = await fetch('/dashboard-data');
      const dashboardData = await dashboardResponse.json();
      const saldoAtual = dashboardData.balance;

      // Verifica se o saldo é suficiente
      if (saldoAtual < valorPago) {
          return res.status(400).json({ error: 'Saldo insuficiente para pagar a parcela.' });
      }

      // Registrar o pagamento da parcela
      const parcelaPaga = await prisma.parcelaPaga.create({
          data: {
              itemId,
              valorPago,
              dataPagamento: new Date(),
          },
      });

      // Atualizar o status da dívida, se necessário
      const item = await prisma.item.findUnique({ where: { id: itemId } });
      if (item.installment) {
          const totalParcelas = item.installmentCount || 0;
          const parcelasPagas = await prisma.parcelaPaga.count({ where: { itemId } });

          if (parcelasPagas >= totalParcelas) {
              await prisma.item.update({
                  where: { id: itemId },
                  data: { status: 'paga' },
              });
          }
      }

      res.json({ success: true, parcelaPaga });
  } catch (error) {
      console.error('Erro ao pagar parcela:', error);
      res.status(500).json({ error: 'Erro ao pagar parcela' });
  }
});
  // Rota para a página de dívidas
app.get('/dividas',  isAuthenticated, (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'dividas.html'));
});

// Rota para listar todas as dívidas
app.get('/api/dividas', async (req, res) => {
  try {
    const userId = req.session.userId;
    const dividas = await prisma.item.findMany({
      where: { 
        userId: userId, 
        type: 'divida' 
      },
      include: {
        parcelasPagas: true // Inclui as parcelas pagas
      }
    });
    
    // Processa as dívidas para calcular valores
    const dividasProcessadas = dividas.map(divida => {
      const valorPago = divida.parcelasPagas.reduce((sum, parcela) => sum + parcela.valorPago, 0);
      const valorRestante = divida.amount - valorPago;
      const parcelasRestantes = divida.installment ? 
        Math.ceil(valorRestante / divida.valorParcela) : 0;
      
      return {
        ...divida,
        valorPago,
        valorRestante,
        parcelasRestantes
      };
    });

    res.status(200).json(dividasProcessadas);
  } catch (error) {
    console.error('Erro ao buscar dívidas:', error);
    res.status(500).json({ error: 'Erro ao buscar dívidas' });
  }
});
  
  // Rota para buscar detalhes de uma dívida específica
  app.get('/api/dividas/:id', async (req, res) => {
    const { id } = req.params;
  
    try {
      const divida = await prisma.item.findUnique({
        where: { id: parseInt(id) },
      });
  
      if (!divida) {
        return res.status(404).json({ error: 'Dívida não encontrada' });
      }
  
      res.status(200).json(divida);
    } catch (error) {
      console.error('Erro ao buscar dívida:', error);
      res.status(500).json({ error: 'Erro ao buscar dívida' });
    }
  });
  
  // Rota para listar parcelas pagas de uma dívida específica
  app.get('/api/dividas/:id/parcelas-pagas', async (req, res) => {
    const { id } = req.params;
  
    try {
      const parcelasPagas = await prisma.parcelaPaga.findMany({
        where: { itemId: parseInt(id) },
      });
  
      res.status(200).json(parcelasPagas);
    } catch (error) {
      console.error('Erro ao buscar parcelas pagas:', error);
      res.status(500).json({ error: 'Erro ao buscar parcelas pagas' });
    }
  });
  
  
  
// Rota para pagar uma parcela
app.post('/api/dividas/:id/pagar-parcela', isAuthenticated, async (req, res) => {
  try {
    const { id } = req.params;
    
    // Busca a dívida com o valor FIXO da parcela
    const divida = await prisma.item.findUnique({
      where: { id: parseInt(id) }
    });

    if (!divida || !divida.installment || !divida.valorParcela) {
      return res.status(400).json({ error: 'Dívida não encontrada ou não parcelada' });
    }

    // Usa o valor FIXO da parcela
    const valorParcela = divida.valorParcela;
    
    // Registra o pagamento
    await prisma.parcelaPaga.create({
      data: {
        itemId: divida.id,
        valorPago: valorParcela,
        dataPagamento: new Date()
      }
    });

    // Atualiza o valor pago total na dívida
    const novoValorPago = (divida.valorPago || 0) + valorParcela;
    
    await prisma.item.update({
      where: { id: divida.id },
      data: {
        valorPago: novoValorPago,
        status: novoValorPago >= divida.amount ? 'paga' : divida.status
      }
    });

    res.json({ success: true });
  } catch (error) {
    console.error('Erro ao pagar parcela:', error);
    res.status(500).json({ error: 'Erro ao pagar parcela' });
  }
});


// Rota para deletar uma dívida
app.delete('/api/dividas/:id', async (req, res) => {
  const { id } = req.params;

  try {
    console.log('Tentando deletar a dívida com ID:', id);

    // Verifica se a dívida existe
    const divida = await prisma.item.findUnique({
      where: { id: parseInt(id) },
    });

    if (!divida) {
      return res.status(404).json({ error: 'Dívida não encontrada' });
    }

    // Deleta todas as parcelas pagas associadas à dívida
    await prisma.parcelaPaga.deleteMany({
      where: { itemId: parseInt(id) },
    });

    // Deleta a dívida
    await prisma.item.delete({
      where: { id: parseInt(id) },
    });

    console.log('Dívida deletada com sucesso:', id);
    res.status(200).json({ message: 'Dívida deletada com sucesso' });
  } catch (error) {
    console.error('Erro ao deletar dívida:', error);
    res.status(500).json({ error: 'Erro ao deletar dívida' });
  }
});

// Função auxiliar para calcular os dados do dashboard
async function getDashboardData(userId) {
  try {
      const items = await prisma.item.findMany({
          where: { userId },
          include: { parcelasPagas: true },
      });

      let totalIncome = 0;
      let totalOutflows = 0;
      let totalParcelasPagas = 0;
      let totalExpenses = 0;
      let totalDividasQuitadas = 0;

      items.forEach((item) => {
          if (item.type === 'entrada') {
              totalIncome += item.amount;
          } else if (item.type === 'saida') {
              totalOutflows += item.amount;
          } else if (item.type === 'divida') {
              if (item.status === 'paga' && !item.installment) {
                  totalDividasQuitadas += item.amount;
              } else if (item.status !== 'paga') {
                  if (item.installment) {
                      const totalParcelas = item.installmentCount || 0;
                      const parcelasPagas = item.parcelasPagas.length;
                      const valorPorParcela = item.amount / totalParcelas;
                      totalExpenses += valorPorParcela * (totalParcelas - parcelasPagas);
                  } else {
                      totalExpenses += item.amount;
                  }
              }
          }

          if (item.parcelasPagas?.length > 0) {
              item.parcelasPagas.forEach((parcela) => {
                  totalParcelasPagas += parcela.valorPago;
              });
          }
      });

      const balance = totalIncome - totalOutflows - totalParcelasPagas - totalDividasQuitadas;

      return {
          totalIncome,
          totalOutflows,
          totalParcelasPagas,
          totalDividasQuitadas,
          totalExpenses,
          balance,
          items
      };
  } catch (error) {
      console.error('Erro ao calcular dados do dashboard:', error);
      throw error;
  }
}

// Rota para pagar uma dívida à vista
app.post('/api/dividas/:id/pagar-avista', isAuthenticated, async (req, res) => {
  const { id } = req.params;

  try {
    // Busca a dívida
    const divida = await prisma.item.findUnique({
      where: { id: parseInt(id) },
      include: { parcelasPagas: true }
    });

    if (!divida) {
      return res.status(404).json({ error: 'Dívida não encontrada' });
    }

    // Calcula valor já pago
    const valorPago = divida.parcelasPagas.reduce((sum, parcela) => sum + parcela.valorPago, 0);
    const valorRestante = divida.amount - valorPago;

    // Registra o pagamento total restante como uma parcela
    await prisma.parcelaPaga.create({
      data: {
        itemId: divida.id,
        valorPago: valorRestante,
        dataPagamento: new Date()
      }
    });

    // Marca a dívida como paga
    await prisma.item.update({
      where: { id: parseInt(id) },
      data: { 
        status: 'paga',
        valorPago: divida.amount,
        installmentCount: 0
      }
    });

    res.status(200).json({ message: 'Dívida quitada à vista com sucesso' });
  } catch (error) {
    console.error('Erro ao pagar à vista:', error);
    res.status(500).json({ error: 'Erro ao pagar à vista' });
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