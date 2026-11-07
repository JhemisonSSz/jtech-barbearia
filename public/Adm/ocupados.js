// ocupados.js — "Horários ocupados" (coleção pública horarios_ocupados).
//
// Por quê: as reservas completas (nome e telefone do cliente) ficam em reservas_<profissional>
// e SÓ o admin pode ler. Mas o site do cliente precisa saber quais horários já estão tomados.
// Então cada reserva ou bloqueio tem uma "sombra" aqui, só com: colecao, data, hora e duracaoMin.
//
// O id da sombra é "<colecao>__<id da reserva>", por exemplo:
//   reservas_rodrigo_dos_anjos__2026-11-10_14:00
//
// Quem grava:
//   - o site do cliente, junto com a reserva (script.js, na mesma transação);
//   - o admin, por estas funções, sempre que agenda, edita, remove, bloqueia ou desbloqueia.
// sincronizarOcupados() refaz tudo de hoje em diante (roda ao abrir o painel), para corrigir
// qualquer diferença.
import { db, todayYmd } from "./firebase.js";
import {
  doc, setDoc, deleteDoc, getDocs, collection, query, where,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

export const COL_OCUPADOS = "horarios_ocupados";
export const idOcupado = (colecao, idReserva) => `${colecao}__${idReserva}`;

// Só os dados que podem ser públicos
const sombra = (colecao, reserva) => ({
  colecao,
  data: reserva.data,
  hora: reserva.hora,
  duracaoMin: Number(reserva.servicoTempoMin ?? reserva.tempoMin ?? reserva.duracaoMin) || 30,
});

// Marca (ou atualiza) o horário de uma reserva/bloqueio como ocupado
export function marcarOcupado(colecao, idReserva, reserva) {
  return setDoc(doc(db, COL_OCUPADOS, idOcupado(colecao, idReserva)), sombra(colecao, reserva));
}

// Libera o horário (reserva removida ou desbloqueada)
export function liberarHorario(colecao, idReserva) {
  return deleteDoc(doc(db, COL_OCUPADOS, idOcupado(colecao, idReserva)));
}

// Confere as reservas de hoje em diante de cada profissional e acerta as sombras:
// cria as que faltam, corrige as diferentes e apaga as que sobraram.
// Devolve quantas mudanças fez.
export async function sincronizarOcupados(colecoes) {
  const lista = [...new Set((colecoes || []).filter(Boolean))];
  if (!lista.length) return 0;
  const hoje = todayYmd();

  const atuais = new Map();
  (await getDocs(query(collection(db, COL_OCUPADOS), where("data", ">=", hoje))))
    .forEach((d) => atuais.set(d.id, d.data()));

  const devem = new Map();
  for (const colecao of lista) {
    (await getDocs(query(collection(db, colecao), where("data", ">=", hoje)))).forEach((d) => {
      const r = d.data() || {};
      if (r.data && r.hora) devem.set(idOcupado(colecao, d.id), sombra(colecao, r));
    });
  }

  const tarefas = [];
  for (const [id, s] of devem) {
    const a = atuais.get(id);
    const igual = a && a.colecao === s.colecao && a.data === s.data && a.hora === s.hora && a.duracaoMin === s.duracaoMin;
    if (!igual) tarefas.push(setDoc(doc(db, COL_OCUPADOS, id), s));
  }
  for (const id of atuais.keys()) {
    if (!devem.has(id)) tarefas.push(deleteDoc(doc(db, COL_OCUPADOS, id)));
  }
  await Promise.all(tarefas);
  return tarefas.length;
}
