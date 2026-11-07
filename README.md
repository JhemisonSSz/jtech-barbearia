# Jtech Barbearia

Site de barbearia com **agendamento online** e **painel administrativo**. É um projeto modelo do portfólio JhemisonTech: a barbearia, os nomes e os telefones são fictícios.

- **Site:** https://jtech-barbearia.web.app
- **Painel:** https://jtech-barbearia.web.app/Adm/

Tudo é feito em HTML, CSS e JavaScript puros, sem build. O Firebase (Firestore, Auth, Storage e Hosting) é carregado pelo CDN, como ES modules.

---

## O que o site faz

### Para o cliente (`public/index.html` + `public/script.js`)
- Mostra os serviços, os profissionais e o horário de funcionamento. Tudo vem do banco, e você muda pelo painel.
- O agendamento acontece em 4 passos:
  1. O cliente clica em **Agendar** no card do profissional.
  2. Informa nome e telefone.
  3. Responde se é do **JT Club** (o clube de assinatura).
  4. Escolhe o serviço, a data e a hora.
- **A lista de horários já mostra só o que está livre.** Ela leva em conta a duração do serviço, as reservas, os bloqueios, as folgas e os feriados.
- Na hora de confirmar, o site confere de novo se o horário ainda está livre, porque duas pessoas podem tentar o mesmo horário ao mesmo tempo.

### Para o dono (`public/Adm/`)
| Aba | Arquivo | O que faz |
|---|---|---|
| Agenda | `agenda.js` | Mostra o dia de cada profissional. Também cria, edita e remove agendamentos, e bloqueia e desbloqueia horários. |
| Clientes | `clientes.js` | Cadastro dos membros do JT Club e dos pagamentos da assinatura. |
| PDV | `pdv.js` | Produtos e vendas no balcão. |
| Relatórios | `relatorios.js` | Faturamento por período e por profissional, comparação entre membros e não membros, despesas e exportação. |
| Contas a pagar | `contasapagar.js` | Lança contas (inclusive parceladas) e marca como pagas. |
| Configurações | `configuracoes.js` | Horários, dias da semana, exceções (folgas e feriados), profissionais e serviços. |
| Link de agendamento | `firebase.js` | Link para enviar aos clientes. |

O `firebase.js` é a base do painel: ele conecta ao Firebase, cuida do login e inicia todas as abas.

---

## Estrutura de arquivos

```
jtech-barbearia/
  firebase.json          configuração do Firebase (só a pasta public/ vai para o site)
  .firebaserc            projeto Firebase: jtech-barbearia
  firestore.rules        regras de segurança do banco (quem lê e quem grava o quê)
  firestore.indexes.json índices do banco (vazio, porque não é preciso nenhum especial)
  README.md              este arquivo
  public/
    index.html  style.css  script.js     site do cliente
    assets/                              imagens (logo-jtech.png é o logo do site)
    Adm/
      index.html  style.css              painel
      firebase.js                        base do painel
      ocupados.js                        "horários ocupados" (ver abaixo)
      agenda.js  clientes.js  pdv.js  relatorios.js  contasapagar.js  configuracoes.js
```

---

## Banco de dados (Firestore)

| Coleção | Guarda | Quem lê | Quem grava |
|---|---|---|---|
| `config` | horário de funcionamento, semana, exceções | todos | admin |
| `servicos` | nome, valor e duração de cada serviço | todos | admin |
| `profissionais` | nome, foto, WhatsApp e a coleção de reservas de cada um | todos | admin |
| `reservas_<profissional>` | cada agendamento, **com nome e telefone do cliente** | **só o admin** | o site **cria** e o admin altera |
| `horarios_ocupados` | só profissional, data, hora e duração | todos | o site cria (junto com a reserva) e o admin altera |
| demais (`raclub_clients`, `vendas`, `despesas`...) | dados do painel | admin | admin |

### Por que existe `horarios_ocupados`

O site precisa saber quais horários estão tomados, mas **não pode** ver o nome e o telefone de quem agendou. Por isso cada reserva tem uma "sombra" pública, só com o horário:

```
reservas_rodrigo_dos_anjos / 2026-11-10_14:00                    ← privada (nome, telefone, serviço...)
horarios_ocupados / reservas_rodrigo_dos_anjos__2026-11-10_14:00 ← pública { colecao, data, hora, duracaoMin }
```

Quem mantém essas sombras:
- **O site do cliente** grava a reserva e a sombra **juntas**, na mesma transação. As regras do banco recusam uma sem a outra.
- **O painel** atualiza a sombra sempre que você agenda, edita, remove, bloqueia ou desbloqueia um horário (`ocupados.js`).
- **Ao abrir o painel**, `sincronizarOcupados()` confere tudo de hoje em diante e corrige o que estiver diferente.

> **Dica:** se você apagar uma reserva direto no console do Firebase, abra o painel uma vez. Ele remove a sombra que sobrou, e o horário volta a aparecer livre no site.

---

## Login do painel

Só entra no painel quem usa um e-mail da lista de administradores. Essa lista fica em **dois lugares**, e os dois precisam estar iguais:
- `firestore.rules` → `emailsAdmin()` (é o que protege o banco de verdade);
- `public/Adm/firebase.js` → `EMAILS_ADMIN` (só esconde o painel de quem não é admin).

Hoje a lista tem só `teste@jtech.teste`, que é a conta de demonstração. Ela é criada no console do Firebase, em **Authentication → Users → Adicionar usuário**.

Para mostrar o painel a um cliente em potencial:
1. Envie o login e a senha.
2. Depois de usado, **troque a senha** no console.

---

## Editar, salvar e publicar

1. Edite os arquivos no VS Code.
2. Teste: abra o `public/index.html` com o Live Server, ou publique e teste no link.
3. Salve no Git:
   ```
   git add .
   git commit -m "o que mudou"
   git push
   ```
4. Publique **sempre com `--project`**. Sem ele, o Firebase pode publicar no projeto errado.
   ```
   firebase deploy --project jtech-barbearia --only hosting,firestore:rules
   ```
5. Abra o site numa **janela anônima** para conferir se está tudo certo.
