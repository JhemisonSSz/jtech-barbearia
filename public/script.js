// script.js — Site público da barbearia: mostra serviços e profissionais e faz o agendamento online.
// Lê do Firebase só dados públicos (config, serviços, profissionais e horários ocupados) e grava a reserva.

// ===== Navegação mobile & smooth =====
const menuToggle = document.querySelector('.menu-toggle');
const navLinks = document.querySelector('.nav-links');
menuToggle?.addEventListener('click', () => {
  const isOpen = navLinks.classList.toggle('active');
  const icon = menuToggle.querySelector('i');
  menuToggle.setAttribute('aria-expanded', String(isOpen));
  menuToggle.setAttribute('aria-label', isOpen ? 'Fechar menu' : 'Abrir menu');
  icon.className = isOpen ? 'bx bx-x' : 'bx bx-menu';
});
document.querySelectorAll('a[href^="#"]').forEach(a => {
  a.addEventListener('click', e => {
    const id = a.getAttribute('href');
    if (!id || id === '#') return;
    const t = document.getElementById(id.slice(1));
    if (!t) return;
    e.preventDefault();
    window.scrollTo({ top: t.getBoundingClientRect().top + window.pageYOffset - 80, behavior: 'smooth' });
    navLinks?.classList.remove('active');
    menuToggle?.setAttribute('aria-expanded', 'false');
    menuToggle?.setAttribute('aria-label', 'Abrir menu');
    const icon = menuToggle?.querySelector('i');
    if (icon) icon.className = 'bx bx-menu';
  });
});

// ===== Estado =====
let ctx = {
  profissionalNome: null,
  profissionalId: null,
  profissionalDocId: null, // ✅ doc id em /profissionais/{id}
  wa: null,
  colecao: null,
  profKey: null,
  fimExpediente: null,
  diasFolga: null
};

let agendamentoContexto = {
  nomeCliente: '',
  sobrenomeCliente: '',
  telefoneCliente: '',
  produtos: [],
  totalProdutos: 0,
  jtclub: { status: 'nao' },
  servico: null // {nome, valor, tempoMin}
};

// ✅✅✅ AJUSTE CRÍTICO: pegar os elementos corretos do HTML
// (no HTML: <input id="data"> e <select id="hora">)
const dataInput = document.getElementById('data');
const horaSelect = document.getElementById('hora');
const horaStatus = document.getElementById('horaStatus');

// ===== Constantes =====
const REVIEW_URL = document.getElementById('btnAvaliarGoogle')?.getAttribute('href') || '';

const SERVICOS = [
  { nome: 'Corte à máquina', valor: 35, tempoMin: 30 },
  { nome: 'Corte à tesoura', valor: 50, tempoMin: 30 },
  { nome: 'Sobrancelha', valor: 10, tempoMin: 30 },
  { nome: 'Barba', valor: 20, tempoMin: 30 },
  { nome: 'Pigmentação', valor: 40, tempoMin: 30 },
];
const TELEFONE_WHATSAPP = '5573900000000';
const formatarValorServico = (valor) => valor == null ? 'Consulte' : toBRL(valor);

// ===== Dados dinâmicos (Firestore) =====
let HORARIO_FUNCIONAMENTO = { inicio: '09:00', fim: '18:30' }; // fallback
let SERVICOS_REMOTE = null;        // [{id,nome,valor,tempoMin}]
let PROFISSIONAIS_REMOTE = null;   // [{id,nome,fotoUrl,whatsapp,colecao,fimExpediente?,diasFolga?}]

const toBRL = (n) => (Number(n) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

// ===== Helpers (profissionalId) =====
function getProfIdFromCollection(col) {
  const c = (col || '').trim();
  if (!c) return null;
  if (c.startsWith('reservas_')) return c.replace(/^reservas_/, '').trim() || null;
  return null;
}

// ===== Helpers (nome para regras) =====
function getProfKeyFromName(nome) {
  const n = (nome || '').trim();
  if (!n) return null;
  // pega o primeiro nome (Rodrigo dos Anjos -> Rodrigo)
  return n.split(/\s+/)[0].trim();
}
function getFimExpedienteEfetivo() {
  // prioridade: ctx.fimExpediente (do Firestore/btn) -> mapa por primeiro nome -> horário global
  const key = ctx.profKey || getProfKeyFromName(ctx.profissionalNome) || null;
  if (ctx.fimExpediente) return ctx.fimExpediente;
  if (key && MAPA_FIM_EXPEDIENTE[key]) return MAPA_FIM_EXPEDIENTE[key];
  return HORARIO_FUNCIONAMENTO.fim || '18:30';
}
function getDiasFolgaEfetivo() {
  // prioridade: ctx.diasFolga (do Firestore/btn) -> mapa por primeiro nome -> []
  if (Array.isArray(ctx.diasFolga)) return ctx.diasFolga;
  const key = ctx.profKey || getProfKeyFromName(ctx.profissionalNome) || null;
  return (key && DIAS_FOLGA[key]) ? DIAS_FOLGA[key] : [];
}

// ===== Helpers de modal (ACESSÍVEIS) =====
let __lastActiveEl = null;

function __getFocusable(container) {
  return container.querySelectorAll(
    'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])'
  );
}
function __trapKeydown(e) {
  if (e.key !== 'Tab') return;
  const focusables = __getFocusable(e.currentTarget);
  if (!focusables.length) return;
  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault(); last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault(); first.focus();
  }
}
function abrirModal(id) {
  const el = document.getElementById(id);
  if (!el) return;
  __lastActiveEl = document.activeElement;

  el.style.display = 'flex';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.removeAttribute('aria-hidden');

  const focusables = __getFocusable(el);
  (focusables[0] || el).focus();

  el.addEventListener('keydown', __trapKeydown);

  el.__escHandler = (ev) => { if (ev.key === 'Escape') fecharModal(id); };
  document.addEventListener('keydown', el.__escHandler);
}
function fecharModal(id) {
  const el = document.getElementById(id);
  if (!el) return;

  el.style.display = 'none';
  el.setAttribute('aria-hidden', 'true');
  el.removeAttribute('aria-modal');
  el.removeEventListener('keydown', __trapKeydown);

  if (el.__escHandler) {
    document.removeEventListener('keydown', el.__escHandler);
    delete el.__escHandler;
  }
  if (__lastActiveEl && typeof __lastActiveEl.focus === 'function') {
    __lastActiveEl.focus();
  }
}
window.fecharModal = fecharModal;

// ===== Persistência (JT Club) =====
function salvarContextoSessao() {
  try {
    sessionStorage.setItem('agendamentoCtx', JSON.stringify(agendamentoContexto));
    sessionStorage.setItem('ctx', JSON.stringify(ctx));
  } catch { }
}
function restaurarContextoSessao() {
  try {
    const c1 = sessionStorage.getItem('agendamentoCtx');
    const c2 = sessionStorage.getItem('ctx');
    if (c1) agendamentoContexto = JSON.parse(c1);
    if (c2) ctx = JSON.parse(c2);
  } catch { }
}
function tentarRetomarPosCheckout() {
  const flag = sessionStorage.getItem('jtclubCheckoutRedirect');
  if (flag === '1') {
    sessionStorage.removeItem('jtclubCheckoutRedirect');
    restaurarContextoSessao();
    if (ctx?.colecao && (ctx?.profissionalNome || ctx?.profissionalId)) {
      agendamentoContexto.jtclub = { status: 'assinar_link' };
      fecharModal('modalJTClub');
      abrirModalAgendamento();
    }
  }
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') tentarRetomarPosCheckout();
});

// ===== Fluxo Nome → JT Club → Agendamento =====
const nomeClienteInput = document.getElementById('nomeCliente');
const sobrenomeClienteInput = document.getElementById('sobrenomeCliente');
const telefoneClienteInput = document.getElementById('telefoneCliente');

const onlyDigits = (s) => (s || '').replace(/\D/g, '');

let retomarAgendamentoDepoisDoCliente = false;

document.getElementById('btnClienteContinuar')?.addEventListener('click', () => {
  const nome = (nomeClienteInput.value || '').trim();
  const sobrenome = (sobrenomeClienteInput.value || '').trim();
  const telefoneRaw = (telefoneClienteInput.value || '').trim();
  const telDigits = onlyDigits(telefoneRaw);

  if (!nome) { alert('Informe o nome.'); nomeClienteInput.focus(); return; }
  if (!sobrenome) { alert('Informe o sobrenome.'); sobrenomeClienteInput.focus(); return; }
  if (telDigits.length < 10 || telDigits.length > 13) {
    alert('Informe um telefone válido com DDD (ex.: 81999999999).');
    telefoneClienteInput.focus();
    return;
  }

  agendamentoContexto.nomeCliente = nome;
  agendamentoContexto.sobrenomeCliente = sobrenome;
  agendamentoContexto.telefoneCliente = telDigits.startsWith('55') ? telDigits : ('55' + telDigits);

  // ✅ AJUSTE: removido modal de produtos
  agendamentoContexto.produtos = [];
  agendamentoContexto.totalProdutos = 0;

  fecharModal('modalCliente');
  abrirModalJTClub();
});

// JT Club
const btnJTJaMembro = document.getElementById('btnJTJaMembro');
const btnJTNao = document.getElementById('btnJTNao');
const btnJTAssinar = document.getElementById('btnJTAssinar');
function abrirModalJTClub() { abrirModal('modalJTClub'); }
btnJTJaMembro?.addEventListener('click', () => {
  agendamentoContexto.jtclub = { status: 'membro' };
  fecharModal('modalJTClub');
  abrirModalAgendamento({ preservarSelecao: retomarAgendamentoDepoisDoCliente });
  retomarAgendamentoDepoisDoCliente = false;
});
btnJTNao?.addEventListener('click', () => {
  agendamentoContexto.jtclub = { status: 'nao' };
  fecharModal('modalJTClub');
  abrirModalAgendamento({ preservarSelecao: retomarAgendamentoDepoisDoCliente });
  retomarAgendamentoDepoisDoCliente = false;
});
if (btnJTAssinar) {
  btnJTAssinar.addEventListener('click', () => {
    agendamentoContexto.jtclub = { status: 'assinar_link' };
    salvarContextoSessao();
    fecharModal('modalJTClub');
    abrirModalAgendamento({ preservarSelecao: retomarAgendamentoDepoisDoCliente });
    retomarAgendamentoDepoisDoCliente = false;
  });
}

// STEP base para os horários (igual no admin)
const STEP_MIN = 30;

const MAPA_FIM_EXPEDIENTE = {
  'Rodrigo': '18:30',
  'Melqui': '17:30',
  'João': '18:30' // João Victor -> primeiro nome "João"
};

const DIAS_FOLGA = {
  'João': [0, 2],
  'Rodrigo': [0],
  'Melqui': [0]
};

function folgaMsg(profNome) {
  const key = getProfKeyFromName(profNome) || profNome;
  if (key === 'João') return 'João Victor não atende às terças nem aos domingos. Por favor, escolha outro dia.';
  if (key === 'Rodrigo' || key === 'Melqui') return `${key} não atende aos domingos. Por favor, escolha outro dia.`;
  return 'Profissional indisponível para esta data. Escolha outro dia.';
}

const hhmmToMin = (hhmm) => {
  const [h, m] = String(hhmm || '00:00').split(':').map(Number);
  return (h * 60) + (m || 0);
};
const minToHHMM = (min) => {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
};

function getServicoSelecionadoTempoMin() {
  const t = Number(agendamentoContexto?.servico?.tempoMin);
  return Number.isFinite(t) && t > 0 ? t : 30; // fallback
}

function gerarSlotsDoDia(inicioHHMM, fimHHMM, passoMin, duracaoMin) {
  const ini = hhmmToMin(inicioHHMM);
  const fim = hhmmToMin(fimHHMM);
  const ultimoInicio = fim - duracaoMin;
  const out = [];
  for (let t = ini; t <= ultimoInicio; t += passoMin) out.push(minToHHMM(t));
  return out;
}

// Compat: reagendamento
function fillHorasForProf(profNome, selectEl, duracaoMinOpt) {
  const dur = Number(duracaoMinOpt) || 30;
  const passo = STEP_MIN; // ✅ passo fixo

  const fimEfetivo = getFimExpedienteEfetivo();
  const lista = gerarSlotsDoDia(
    HORARIO_FUNCIONAMENTO.inicio || '09:00',
    fimEfetivo || '18:30',
    passo,
    dur
  );

  const target = selectEl || horaSelect;
  if (!target) return;

  target.innerHTML =
    `<option value="">Selecione um horário</option>` +
    lista.map(h => `<option value="${h}">${h}</option>`).join('');
}

function intervalosConflitam(aIni, aFim, bIni, bFim) {
  return aIni < bFim && bIni < aFim;
}

// As reservas completas (nome, telefone) são privadas. O site lê só os "horários ocupados":
// coleção horarios_ocupados, com colecao, data, hora e duracaoMin (ver Adm/ocupados.js).
const COL_OCUPADOS = 'horarios_ocupados';
const idOcupado = (colecao, idReserva) => `${colecao}__${idReserva}`;
const consultaOcupados = (colecao, ymd) =>
  query(collection(db, COL_OCUPADOS), where('colecao', '==', colecao), where('data', '==', ymd));

async function getReservasIntervalosByDate(colecao, ymd) {
  const col = (colecao || '').trim();
  if (!col) return [];
  const snap = await getDocs(consultaOcupados(col, ymd));
  const items = [];
  snap.forEach(d => {
    const row = d.data() || {};
    const h = row.hora;
    if (!h) return;

    // horário bloqueado pelo admin também aparece aqui e ocupa o slot
    const tempo = Number(row.duracaoMin);
    const dur = Number.isFinite(tempo) && tempo > 0 ? tempo : 30;
    const ini = hhmmToMin(h);
    items.push({ ini, fim: ini + dur });
  });
  return items;
}

async function preencherHorasDisponiveis() {
  const ymd = dataInput?.value;
  const col = ctx?.colecao;
  const requestId = (preencherHorasDisponiveis.requestId || 0) + 1;
  preencherHorasDisponiveis.requestId = requestId;

  if (!horaSelect) return;

  horaSelect.innerHTML = `<option value="">${ymd ? 'Carregando horários...' : 'Escolha uma data para ver os horários'}</option>`;
  horaSelect.dataset.availabilityChecked = 'false';
  if (!ymd) {
    if (horaStatus) horaStatus.textContent = 'Os horários aparecem após selecionar uma data.';
    return;
  }
  if (!col) {
    if (horaStatus) horaStatus.textContent = 'Escolha um profissional para consultar os horários.';
    return;
  }

  if (!FIREBASE_CONFIGURADO) {
    horaSelect.innerHTML = '<option value="">Disponibilidade indisponível</option>';
    if (horaStatus) {
      horaStatus.textContent = 'Configure o Firebase para consultar os horários livres deste profissional.';
    }
    return;
  }

  if (!dataPermitidaParaProf(ymd)) {
    horaSelect.innerHTML = '<option value="">Indisponível nesta data</option>';
    horaSelect.dataset.availabilityChecked = 'true';
    if (horaStatus) horaStatus.textContent = 'Este profissional não atende nesta data. Escolha outro dia.';
    return;
  }

  let availability = null;
  try {
    availability = await getDisponibilidadeDia(ymd, ctx.profissionalDocId);
  } catch (error) {
    if (requestId !== preencherHorasDisponiveis.requestId) return;
    console.error('[DISP] Não foi possível consultar a disponibilidade:', error);
    horaSelect.innerHTML = '<option value="">Não foi possível consultar os horários</option>';
    if (horaStatus) horaStatus.textContent = 'Tente novamente mais tarde; não foi possível confirmar os horários deste dia.';
    return;
  }

  if (requestId !== preencherHorasDisponiveis.requestId) return;
  if (availability?.fechado === true) {
    horaSelect.innerHTML = '<option value="">Indisponível nesta data</option>';
    horaSelect.dataset.availabilityChecked = 'true';
    if (horaStatus) horaStatus.textContent = 'Não há atendimento nesta data. Escolha outro dia.';
    return;
  }

  const duration = getServicoSelecionadoTempoMin();
  const candidates = gerarSlotsDoDia(
    availability?.inicio || HORARIO_FUNCIONAMENTO.inicio || '09:00',
    availability?.fim || getFimExpedienteEfetivo() || '18:30',
    STEP_MIN,
    duration
  );
  try {
    const appointments = await getReservasIntervalosByDate(col, ymd);
    if (requestId !== preencherHorasDisponiveis.requestId) return;
    const disponiveis = candidates.filter(slot => {
      const start = hhmmToMin(slot);
      return !appointments.some(item => intervalosConflitam(start, start + duration, item.ini, item.fim));
    });

    horaSelect.innerHTML =
      `<option value="">${disponiveis.length ? 'Selecione um horário' : 'Sem horários disponíveis nesta data'}</option>` +
      disponiveis.map(h => `<option value="${h}">${h}</option>`).join('');
    if (horaStatus) {
      horaStatus.textContent = disponiveis.length
        ? `${disponiveis.length} horário(s) disponível(is) para este profissional.`
        : 'Não há horários disponíveis para este profissional nesta data.';
    }
    horaSelect.dataset.availabilityChecked = 'true';
  } catch (e) {
    if (requestId !== preencherHorasDisponiveis.requestId) return;
    console.error('[HORARIOS] Não foi possível consultar reservas:', e);
    horaSelect.innerHTML = '<option value="">Não foi possível consultar os horários</option>';
    if (horaStatus) horaStatus.textContent = 'Tente novamente mais tarde; não foi possível confirmar a disponibilidade.';
  }
}

function resetSelectVisual(selectEl) {
  const target = selectEl || horaSelect;
  if (!target) return;
  for (const opt of target.options) {
    if (!opt.value) continue;
    opt.disabled = false;
    opt.classList.remove('reservado');
  }
}

function weekdayFromYMD(ymd) {
  return new Date(`${ymd}T12:00:00`).getDay();
}

// ===== Disponibilidade via Firestore (semana + exceções) =====
const CFG_SEMANA_DOC = ['config', 'semana'];
const CFG_HORARIOS_DOC = ['config', 'horarios']; // fallback antigo
const CFG_EXCECOES_BASE = ['config', 'excecoes', 'dias']; // config/excecoes/dias/{ymd}

async function readSemana() {
  // Preferencial: config/semana
  try {
    const ref = doc(db, ...CFG_SEMANA_DOC);
    const snap = await getDoc(ref);
    if (snap.exists()) return snap.data() || null;
  } catch { }

  // Fallback: config/horarios
  try {
    const ref = doc(db, ...CFG_HORARIOS_DOC);
    const snap = await getDoc(ref);
    if (snap.exists()) {
      const d = snap.data() || {};
      return {
        weekdays: [1, 2, 3, 4, 5, 6], // seg-sáb
        dayStart: d.inicio || '09:00',
        dayEnd: d.fim || '18:30'
      };
    }
  } catch { }

  return null;
}

async function readExcecaoGeral(ymd) {
  try {
    const ref = doc(db, ...CFG_EXCECOES_BASE, ymd);
    const snap = await getDoc(ref);
    return snap.exists() ? (snap.data() || null) : null;
  } catch {
    return null;
  }
}

async function readExcecaoProf(profDocId, ymd) {
  if (!profDocId) return null;
  try {
    const ref = doc(db, 'profissionais', profDocId, 'excecoes', ymd);
    const snap = await getDoc(ref);
    return snap.exists() ? (snap.data() || null) : null;
  } catch {
    return null;
  }
}

// prioridade: prof > geral > semana
async function getDisponibilidadeDia(ymd, profDocId) {
  const semana = await readSemana();
  const excG = await readExcecaoGeral(ymd);
  const excP = await readExcecaoProf(profDocId, ymd);

  if (excP && excP.fechado === true) return { fechado: true };
  if (excP && excP.inicio && excP.fim) return { fechado: false, inicio: excP.inicio, fim: excP.fim, fonte: 'prof' };

  if (excG && excG.fechado === true) return { fechado: true };
  if (excG && excG.inicio && excG.fim) return { fechado: false, inicio: excG.inicio, fim: excG.fim, fonte: 'geral' };

  const w = weekdayFromYMD(ymd);
  const weekdays = Array.isArray(semana?.weekdays) ? semana.weekdays : [1, 2, 3, 4, 5, 6];
  if (!weekdays.includes(w)) return { fechado: true };

  return {
    fechado: false,
    inicio: semana?.dayStart || HORARIO_FUNCIONAMENTO.inicio || '09:00',
    fim: semana?.dayEnd || HORARIO_FUNCIONAMENTO.fim || '18:30',
    fonte: 'semana'
  };
}

function dataPermitidaParaProf(ymd, profNome = ctx.profissionalNome) {
  if (!ymd) return true;
  const folgas = getDiasFolgaEfetivo();
  const w = weekdayFromYMD(ymd);
  return !folgas.includes(w);
}

async function abrirModalAgendamento({ preservarSelecao = false } = {}) {
  if (!dataInput || !horaSelect) return;

  const dataAnterior = preservarSelecao ? dataInput.value : '';
  const horaAnterior = preservarSelecao ? horaSelect.value : '';
  const hoje = new Date();
  const y = hoje.getFullYear();
  const m = String(hoje.getMonth() + 1).padStart(2, "0");
  const d = String(hoje.getDate()).padStart(2, "0");
  dataInput.min = `${y}-${m}-${d}`;
  dataInput.value = dataAnterior;

  const folgas = getDiasFolgaEfetivo();
  if (folgas.length) dataInput.title = "Este profissional não atende em alguns dias da semana.";
  else dataInput.removeAttribute('title');

  await preencherHorasDisponiveis();

  const horarioAnteriorDisponivel = [...horaSelect.options].some(
    option => option.value === horaAnterior && !option.disabled
  );
  horaSelect.value = horarioAnteriorDisponivel ? horaAnterior : '';

  const display = document.getElementById('servicoDisplay');
  display.value = agendamentoContexto.servico
    ? `${agendamentoContexto.servico.nome} — ${formatarValorServico(agendamentoContexto.servico.valor)}`
    : '';

  abrirModal('modal');
}

// Botões dos profissionais (agendar)
bindProfButtons();

// ===== Firebase =====
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  initializeFirestore,
  doc, getDoc, setDoc, serverTimestamp,
  collection, query, where, getDocs, runTransaction
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyBP9ZudAzyNI1wzb-5G_YLnNfCQH6RV0zM",
  authDomain: "jtech-barbearia.firebaseapp.com",
  projectId: "jtech-barbearia",
  storageBucket: "jtech-barbearia.firebasestorage.app",
  messagingSenderId: "637085311669",
  appId: "1:637085311669:web:8655ac372c78a973a7d4fc"
};
const FIREBASE_CONFIGURADO = Boolean(firebaseConfig.apiKey && firebaseConfig.projectId && firebaseConfig.appId);
const app = initializeApp(firebaseConfig);
const db = initializeFirestore(app, { experimentalAutoDetectLongPolling: true });

// ===== Carregar dados públicos do Firestore =====
async function carregarHorarioFuncionamento() {
  const elTxt = document.getElementById('horarioFuncionamentoTexto');
  try {
    const ref = doc(db, 'config', 'horarios');
    const snap = await getDoc(ref);
    if (snap.exists()) {
      const data = snap.data() || {};
      if (data.inicio) HORARIO_FUNCIONAMENTO.inicio = data.inicio;
      if (data.fim) HORARIO_FUNCIONAMENTO.fim = data.fim;
    }
  } catch (e) {
    console.warn('[CFG] Não foi possível carregar horário de funcionamento:', e);
  }
  if (elTxt) {
    elTxt.textContent = `Seg-Sáb: ${HORARIO_FUNCIONAMENTO.inicio} às ${HORARIO_FUNCIONAMENTO.fim}`;
  }
}

async function carregarServicos() {
  try {
    const snap = await getDocs(collection(db, 'servicos'));
    const arr = [];
    snap.forEach(document => {
      const data = document.data() || {};
      arr.push({
        id: document.id,
        nome: (data.nome || data.servicoNome || '').trim(),
        valor: Number(data.valor ?? data.preco ?? data.servicoValor ?? 0),
        tempoMin: Number(data.tempoMin ?? data.tempo ?? data.duracaoMin ?? 30),
      });
    });
    arr.sort((a, b) => (a.nome || '').localeCompare(b.nome || '', 'pt-BR'));
    SERVICOS_REMOTE = arr.filter(s => s.nome);
  } catch (e) {
    console.warn('[SERVICOS] Não foi possível carregar serviços:', e);
    SERVICOS_REMOTE = null;
  }
}

async function carregarProfissionais() {
  try {
    const snap = await getDocs(collection(db, 'profissionais'));
    const arr = [];
    snap.forEach(document => {
      const data = document.data() || {};
      arr.push({
        id: document.id,
        nome: (data.nome || '').trim(),
        fotoUrl: (data.fotoUrl || data.foto || '').trim(),
        whatsapp: (data.whatsapp || data.wa || '').trim(),
        colecao: (data.colecao || data.collection || (data.slug ? `reservas_${data.slug}` : '')).trim(),
        fimExpediente: (data.fimExpediente || data.fim || data.horarioFim || '').trim() || null,
        diasFolga: Array.isArray(data.diasFolga) ? data.diasFolga : (Array.isArray(data.folgas) ? data.folgas : null),
      });
    });
    arr.sort((a, b) => (a.nome || '').localeCompare(b.nome || '', 'pt-BR'));
    PROFISSIONAIS_REMOTE = arr.filter(p => p.nome && p.colecao);
  } catch (e) {
    console.warn('[PROFISSIONAIS] Não foi possível carregar profissionais:', e);
    PROFISSIONAIS_REMOTE = null;
  }
}

function getServicosAtivos() {
  const sitePrices = new Map(SERVICOS.map(service => [service.nome.toLocaleLowerCase('pt-BR'), service.valor]));
  const base = Array.isArray(SERVICOS_REMOTE)
    ? SERVICOS_REMOTE.map(service => {
      const fixedPrice = sitePrices.get(service.nome.toLocaleLowerCase('pt-BR'));
      return { ...service, valor: fixedPrice ?? service.valor };
    })
    : [];
  SERVICOS.forEach(servico => {
    const remoto = base.find(s => s.nome.toLocaleLowerCase('pt-BR') === servico.nome.toLocaleLowerCase('pt-BR'));
    if (!remoto) base.push({ ...servico });
  });

  return [{ nome: 'Selecionar...', valor: null, tempoMin: null, placeholder: true }, ...base];
}

function renderProfissionaisNoSite() {
  const container = document.getElementById('profissionaisContainer');
  if (!container) return;

  const lista = Array.isArray(PROFISSIONAIS_REMOTE) && PROFISSIONAIS_REMOTE.length
    ? PROFISSIONAIS_REMOTE
    : [
      { id: '', nome: 'Rodrigo dos Anjos', fotoUrl: './assets/corte-classico-barbeiro.png', whatsapp: TELEFONE_WHATSAPP, colecao: 'reservas_rodrigo_dos_anjos', fimExpediente: '18:30', diasFolga: [0] }
    ];

  container.innerHTML = '';

  lista.forEach((p) => {
    const card = document.createElement('div');
    card.className = 'haircut';

    const dataFim = p.fimExpediente ? `data-fim="${p.fimExpediente}"` : '';
    const dataFolga = Array.isArray(p.diasFolga) ? `data-folgas='${JSON.stringify(p.diasFolga)}'` : '';

    // ✅ AJUSTE: FECHAR OS BOTÕES CORRETAMENTE
    card.innerHTML = `
      <img src="${p.fotoUrl || './assets/corte-classico-barbeiro.png'}" alt="${p.nome}" class="service-img">
      <div class="haircut-info">
        <strong>${p.nome}</strong>
        <div class="btn-actions">

          <button class="button-contact openModalBtn"
            data-pro="${p.nome}"
            data-prodoc="${p.id || ''}"
            data-wa="${p.whatsapp || ''}"
            data-col="${p.colecao}"
            ${dataFim}
            ${dataFolga}
          >
            <i class='bx bx-calendar'></i> Agende Seu Horário
          </button>

          <button class="button-secondary openReagendaBtn"
            data-pro="${p.nome}"
            data-prodoc="${p.id || ''}"
            data-wa="${p.whatsapp || ''}"
            data-col="${p.colecao}"
            ${dataFim}
            ${dataFolga}
          >
            <i class='bx bx-refresh'></i> Reagendar seu horário
          </button>

        </div>
      </div>
    `;
    container.appendChild(card);
  });

  bindProfButtons();
  bindReagendaButtons(); // ✅ AJUSTE: garantir bind após render
}

// separa o bind para reusar após render
function bindProfButtons() {
  document.querySelectorAll('.openModalBtn').forEach(btn => {
    if (btn.__bound) return;
    btn.__bound = true;
    btn.addEventListener('click', () => {
      ctx.profissionalNome = (btn.dataset.pro || 'Profissional').trim();
      ctx.profissionalDocId = (btn.dataset.prodoc || '').trim() || null;

      ctx.profKey = getProfKeyFromName(ctx.profissionalNome);
      ctx.wa = (btn.dataset.wa || TELEFONE_WHATSAPP).trim();
      ctx.colecao = (btn.dataset.col || 'reservas').trim();
      ctx.profissionalId = getProfIdFromCollection(ctx.colecao) || null;

      // ✅ NOVO: fim e folgas por profissional via dataset
      ctx.fimExpediente = (btn.dataset.fim || '').trim() || null;
      try {
        ctx.diasFolga = btn.dataset.folgas ? JSON.parse(btn.dataset.folgas) : null;
      } catch {
        ctx.diasFolga = null;
      }

      // se trocou profissional, revalidar data/hora (evita ficar selecionado algo inválido)
      if (dataInput?.value) {
        // recalcula horas com fim novo
        preencherHorasDisponiveis();
      }

      salvarContextoSessao();
      retomarAgendamentoDepoisDoCliente = false;
      abrirModalAgendamento();
    });
  });

  // seu reagendamento (abaixo) usa querySelectorAll('.openReagendaBtn') mais embaixo
}

// ✅ AJUSTE: bind do reagendamento precisa acontecer depois que os botões existem no DOM
function bindReagendaButtons() {
  document.querySelectorAll('.openReagendaBtn').forEach(btn => {
    if (btn.__bound) return;
    btn.__bound = true;

    btn.addEventListener('click', () => {
      const digits = String(btn.dataset.wa || TELEFONE_WHATSAPP).replace(/\D/g, '');
      const professional = (btn.dataset.pro || 'profissional').trim();
      const message = encodeURIComponent(`Olá! Gostaria de reagendar meu horário com ${professional}. Pode me ajudar?`);
      window.open(`https://wa.me/${digits}?text=${message}`, '_blank', 'noopener');
    });
  });
}

// Inicialização do site (dados dinâmicos)
renderProfissionaisNoSite();

(async function initSite() {
  if (!FIREBASE_CONFIGURADO) {
    console.warn('[FIREBASE] Configure apiKey, projectId e appId para consultar disponibilidade e confirmar agendamentos.');
  }
  await Promise.all([
    carregarHorarioFuncionamento(),
    carregarServicos(),
    carregarProfissionais(),
  ]);
  renderProfissionaisNoSite();
})();

const confirmarBtn = document.getElementById('confirmarBtn');
const toKey = (ymd, hhmm) => `${ymd}_${hhmm}`;
const normalizeHora = (h) => (h || '').padStart(5, "0");

async function carregarIndisponiveis() {
  await preencherHorasDisponiveis();
}

dataInput?.addEventListener('change', () => {
  preencherHorasDisponiveis();
});

// ===== Modal de Serviço =====
const servicoDisplay = document.getElementById('servicoDisplay');
const servicoLista = document.getElementById('servicoLista');
const servicoCancelar = document.getElementById('servicoCancelar');
const servicoConfirmarWpp = document.getElementById('servicoConfirmarWpp');

const svcSearch = document.getElementById('svcSearch');
let svcFilterText = "";
const norm = (s) => (s || "").normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

function getFilteredServicos() {
  const base = getServicosAtivos().slice(1);
  if (!svcFilterText.trim()) return [{ nome: 'Selecionar...', valor: null, placeholder: true }, ...base];
  const f = norm(svcFilterText);
  const filtered = base.filter(s => norm(s.nome).includes(f));
  return [{ nome: 'Selecionar...', valor: null, placeholder: true }, ...filtered];
}

function renderListaServicos() {
  const items = getFilteredServicos();
  servicoLista.innerHTML = items.map((s) => {
    const checked = agendamentoContexto.servico
      ? (agendamentoContexto.servico.nome === s.nome ? 'checked' : '')
      : (s.placeholder ? 'checked' : '');
    const sub = s.placeholder ? '' : `<div class="svc-muted">${formatarValorServico(s.valor)}</div>`;
    return `
      <label class="svc-row" data-nome="${s.nome}">
        <div class="svc-left">
          <div class="svc-name">${s.nome}</div>
          ${sub}
        </div>
        <input class="svc-radio" type="radio" name="svc" value="${s.nome}" ${checked} />
      </label>
    `;
  }).join('');

  servicoLista.querySelectorAll('.svc-row').forEach(row => {
    row.addEventListener('click', () => {
      const radio = row.querySelector('input[type="radio"]');
      if (!radio) return;
      radio.checked = true;
    });
  });
}

async function abrirServico() {
  svcFilterText = "";
  if (svcSearch) svcSearch.value = "";
  renderListaServicos();
  abrirModal('servicoModal');

  if (!SERVICOS_REMOTE) {
    await carregarServicos();
    renderListaServicos();
  }
}

servicoDisplay?.addEventListener('click', () => { abrirServico(); });
servicoCancelar?.addEventListener('click', () => fecharModal('servicoModal'));
svcSearch?.addEventListener('input', (e) => { svcFilterText = e.target.value || ""; renderListaServicos(); });

servicoConfirmarWpp?.addEventListener('click', async () => {
  const sel = servicoLista.querySelector('input[name="svc"]:checked');
  if (!sel) { alert('Selecione um serviço.'); return; }
  const nomeSel = sel.value;
  const s = getServicosAtivos().find(x => x.nome === nomeSel);
  if (!s || s.placeholder) { alert('Selecione um serviço.'); return; }

  agendamentoContexto.servico = { nome: s.nome, valor: s.valor, tempoMin: s.tempoMin ?? 30 };
  servicoDisplay.value = `${s.nome} — ${formatarValorServico(s.valor)}`;
  fecharModal('servicoModal');

  await preencherHorasDisponiveis();

  if (dataInput.value && horaSelect.value) {
    confirmarBtn.click();
  }
});

// ===== Confirmar agendamento =====
const confResumo = document.getElementById('confResumo');
const btnOkConfirmacao = document.getElementById('btnOkConfirmacao');
btnOkConfirmacao?.addEventListener('click', () => fecharModal('modalConfirmacao'));

confirmarBtn?.addEventListener('click', async () => {
  const data = dataInput?.value;
  const hora = horaSelect?.value;
  if (!data || !hora) { alert("Selecione data e horário."); return; }
  if (horaSelect?.dataset.availabilityChecked !== 'true') {
    alert('Não foi possível confirmar os horários disponíveis. Verifique sua conexão e tente novamente.');
    return;
  }

  if (!(agendamentoContexto.nomeCliente && agendamentoContexto.sobrenomeCliente)) {
    alert("Informe nome e sobrenome.");
    retomarAgendamentoDepoisDoCliente = true;
    fecharModal('modal');
    abrirModal('modalCliente');
    return;
  }
  const phoneDigits = String(agendamentoContexto.telefoneCliente || '').replace(/\D/g, '');
  if (phoneDigits.length < 10 || phoneDigits.length > 13) {
    alert("Informe um telefone válido com DDD.");
    retomarAgendamentoDepoisDoCliente = true;
    fecharModal('modal');
    abrirModal('modalCliente');
    return;
  }

  if (!agendamentoContexto.servico) { alert("Selecione o serviço."); abrirServico(); return; }
  if (!ctx.colecao) { alert("Profissional não definido."); return; }
  if (!ctx.profissionalId) ctx.profissionalId = getProfIdFromCollection(ctx.colecao) || null;

  confirmarBtn.disabled = true;
  const originalText = confirmarBtn.textContent;
  confirmarBtn.textContent = "Reservando...";

  try {
    const hhmm = normalizeHora(hora);
    const col = (ctx.colecao || '').trim();
    const ref = doc(db, col, toKey(data, hhmm));
    const isJtClub = agendamentoContexto?.jtclub?.status === 'membro';
    const nomeCompleto = `${agendamentoContexto.nomeCliente} ${agendamentoContexto.sobrenomeCliente}`.trim();

    const booking = {
      data,
      hora: hhmm,
      profissional: ctx.profissionalId || 'rodrigo_dos_anjos',
      profissionalNome: ctx.profissionalNome || null,
      clienteNome: agendamentoContexto.nomeCliente,
      clienteSobrenome: agendamentoContexto.sobrenomeCliente,
      clienteNomeCompleto: nomeCompleto,
      clienteNomeLower: agendamentoContexto.nomeCliente.toLocaleLowerCase('pt-BR'),
      clienteSobrenomeLower: agendamentoContexto.sobrenomeCliente.toLocaleLowerCase('pt-BR'),
      clienteTelefone: agendamentoContexto.telefoneCliente,
      servicoNome: agendamentoContexto.servico.nome,
      servicoValor: Number(agendamentoContexto.servico.valor),
      servicoTempoMin: Number(agendamentoContexto.servico.tempoMin) || 30,
      produtos: [],
      totalProdutos: 0,
      jtclub: agendamentoContexto.jtclub || { status: 'nao' },
      jtclubMembro: isJtClub,
      clienteTipo: isJtClub ? 'jtclub' : 'cliente',
      tags: isJtClub ? ['jtclub'] : [],
      createdAt: serverTimestamp(),
    };

    const availability = await getDisponibilidadeDia(data, ctx.profissionalDocId);
    if (availability.fechado) {
      const error = new Error('Não há atendimento nesta data. Escolha outro dia.');
      error.code = 'slot-already-booked';
      throw error;
    }

    const dayStart = availability.inicio || HORARIO_FUNCIONAMENTO.inicio || '09:00';
    const dayEnd = availability.fim || getFimExpedienteEfetivo() || '18:30';
    const start = hhmmToMin(hhmm);
    const duration = booking.servicoTempoMin;
    const dayStartMin = hhmmToMin(dayStart);
    const dayEndMin = hhmmToMin(dayEnd);
    const validSlots = gerarSlotsDoDia(dayStart, dayEnd, STEP_MIN, duration);
    if (
      !validSlots.includes(hhmm)
      || start < dayStartMin
      || start + duration > dayEndMin
    ) {
      const error = new Error('Este horário não está mais disponível. Escolha outro, por favor.');
      error.code = 'slot-already-booked';
      throw error;
    }

    // Confere conflitos olhando os "horários ocupados" (públicos), não as reservas (privadas).
    const ocupadoRef = doc(db, COL_OCUPADOS, idOcupado(col, ref.id));
    const existingAppointments = await getDocs(consultaOcupados(col, data));
    const appointmentRefs = new Map([[ocupadoRef.id, ocupadoRef]]);
    const conflictWindowStart = start - 479;
    const conflictWindowEnd = start + duration;
    gerarSlotsDoDia(dayStart, dayEnd, STEP_MIN, 5)
      .filter(slot => {
        const slotStart = hhmmToMin(slot);
        return slotStart >= conflictWindowStart && slotStart < conflictWindowEnd;
      })
      .forEach(slot => {
        const appointmentRef = doc(db, COL_OCUPADOS, idOcupado(col, toKey(data, slot)));
        appointmentRefs.set(appointmentRef.id, appointmentRef);
      });
    existingAppointments.forEach(appointment => {
      appointmentRefs.set(appointment.id, appointment.ref);
    });

    await runTransaction(db, async transaction => {
      const appointmentSnapshots = await Promise.all(
        [...appointmentRefs.values()].map(appointmentRef => transaction.get(appointmentRef))
      );
      const existing = appointmentSnapshots.find(snapshot => snapshot.ref.id === ocupadoRef.id);
      if (existing.exists()) {
        const error = new Error('Este horário já foi reservado. Escolha outro, por favor.');
        error.code = 'slot-already-booked';
        throw error;
      }

      const conflict = appointmentSnapshots.some(document => {
        if (!document.exists()) return false;
        const current = document.data() || {};
        if (current.data !== data || !current.hora) return false;
        const currentStart = hhmmToMin(current.hora);
        const currentDuration = Number(current.duracaoMin) || 30;
        return intervalosConflitam(start, start + duration, currentStart, currentStart + currentDuration);
      });
      if (conflict) {
        const error = new Error('Este horário conflita com outro agendamento. Escolha outro, por favor.');
        error.code = 'slot-already-booked';
        throw error;
      }
      // Grava juntas: a reserva completa (privada) e o horário ocupado (público)
      transaction.set(ref, booking);
      transaction.set(ocupadoRef, { colecao: col, data, hora: hhmm, duracaoMin: booking.servicoTempoMin });
    });

    await carregarIndisponiveis();

    const dataBR = new Date(`${data}T00:00:00`).toLocaleDateString('pt-BR');
    const servicoTxt = agendamentoContexto.servico
      ? `${agendamentoContexto.servico.nome} (${formatarValorServico(agendamentoContexto.servico.valor)})`
      : '—';

    let jtclubTxt = "Não";
    if (agendamentoContexto.jtclub.status === 'membro') jtclubTxt = "Membro";
    else if (agendamentoContexto.jtclub.status === 'assinar' || agendamentoContexto.jtclub.status === 'assinar_link') jtclubTxt = "Deseja assinar";

    if (confResumo) {
      confResumo.innerHTML = `
        <div class="line"><span class="label">Cliente:</span><span>${nomeCompleto}</span></div>
        <div class="line"><span class="label">Profissional:</span><span>${ctx.profissionalNome}</span></div>
        <div class="line"><span class="label">Profissional ID:</span><span>${ctx.profissionalId}</span></div>
        <div class="line"><span class="label">Data:</span><span>${dataBR}</span></div>
        <div class="line"><span class="label">Hora:</span><span>${hhmm}</span></div>
        <div class="line"><span class="label">Serviço:</span><span>${servicoTxt}</span></div>
        <div class="line"><span class="label">JT Club:</span><span>${jtclubTxt}</span></div>
      `;
    }
    fecharModal('modal');
    abrirModal('modalConfirmacao');
  } catch (err) {
    if (err?.code === 'slot-already-booked') {
      await carregarIndisponiveis();
      alert(err.message || "Este horário já foi reservado. Escolha outro, por favor.");
      return;
    }
    console.error("[RESERVA]", err);
    alert("Não foi possível concluir a reserva. Tente novamente.");
  } finally {
    confirmarBtn.disabled = false;
    confirmarBtn.textContent = originalText || "Agendar";
  }
});

// Retomar fluxo pós-checkout
tentarRetomarPosCheckout();