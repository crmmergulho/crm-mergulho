/**
 * Tradutor do envio de OUTRO DeskcommCRM (personalização da Mergulho, nov/2026).
 *
 * ═══ Para que serve ═══
 *
 * O CRM da SDR manda o card para o CRM da unidade pela ação "Avisar outro
 * sistema" (`call_webhook`), cujo envelope é
 * `{ event, occurred_at, delivery_id, data: { lead, contact, ... } }`
 * (`lib/automation/actions/call-webhook.ts`). O mapeador genérico
 * (`mapInboundPayload`) só lê chave de TOPO e descarta objeto aninhado: o card
 * chegava sem nome nem telefone e a captação recusava. É o mesmo caso do RD
 * Station e do Respondi, e a mesma solução: detecção ESTRITA da forma e um
 * tradutor dedicado, chamado antes do genérico e sem tocar nele.
 *
 * ═══ O que atravessa ═══
 *
 * Só o que o envelope já expõe — quem decide o que sai do CRM de origem é a
 * lista de campos públicos do envio, não este módulo:
 *   - nome, telefone e e-mail do contato;
 *   - os campos personalizados do card (a "Observações" da SDR entre eles);
 *   - as ETIQUETAS: as do contato vão para o contato do destino (a modalidade
 *     escolhe a trilha do follow-up) e as do card vão para o card
 *     (`fez experimental`).
 *
 * O id do card de origem vira o `external_id` (`deskcomm:<id>`): o reenvio do
 * mesmo card — retry por timeout, ou a SDR marcando a aula de novo — não
 * duplica o card no destino.
 */
import type { MappedLead } from "@/lib/webhooks/inbound";
import { normalizePhoneBR } from "@/lib/webhooks/inbound";

/** O valor de `source_metadata.origem` do card que nasceu de outro DeskcommCRM. */
export const ORIGEM_DESKCOMM = "deskcomm";

/** Teto de etiquetas por envio e de tamanho de cada uma (o mesmo do vocabulário). */
const MAX_ETIQUETAS = 20;
const MAX_TAMANHO_DA_ETIQUETA = 40;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** String não-vazia (aparada) ou null. */
function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

/**
 * O corpo é o envelope de saída de um DeskcommCRM?
 *
 * ESTRITA de propósito: `event` e `delivery_id` de topo (o carimbo do envio) e
 * `data.contact.phone_number` texto. Um formulário comum não tem essa forma, e
 * um payload que só se parece não cai aqui por acaso.
 */
export function isDeskcommPayload(payload: unknown): boolean {
  if (!isRecord(payload)) return false;
  if (typeof payload.event !== "string" || typeof payload.delivery_id !== "string") return false;
  const data = payload.data;
  if (!isRecord(data)) return false;
  const contato = data.contact;
  return isRecord(contato) && typeof contato.phone_number === "string";
}

/** Etiquetas de texto, aparadas, em minúsculas, sem repetição e dentro dos tetos. */
export function etiquetasDoEnvio(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const vistas = new Set<string>();
  for (const item of v) {
    if (typeof item !== "string") continue;
    const etiqueta = item.trim().toLowerCase();
    if (!etiqueta || etiqueta.length > MAX_TAMANHO_DA_ETIQUETA) continue;
    vistas.add(etiqueta);
    if (vistas.size >= MAX_ETIQUETAS) break;
  }
  return [...vistas];
}

export interface DeskcommMapped extends MappedLead {
  externalId: string | null;
  etiquetasDoContato: string[];
  etiquetasDoCard: string[];
}

/** Puro, sem I/O. Chamar só depois de `isDeskcommPayload`. */
export function mapDeskcommPayload(payload: unknown): DeskcommMapped {
  const raiz = isRecord(payload) ? payload : {};
  const data = isRecord(raiz.data) ? raiz.data : {};
  const contato = isRecord(data.contact) ? data.contact : {};
  const card = isRecord(data.lead) ? data.lead : {};

  const custom_fields: Record<string, string> = {};
  if (isRecord(card.custom_fields)) {
    for (const [chave, valor] of Object.entries(card.custom_fields)) {
      if (typeof valor === "string") {
        if (valor.trim()) custom_fields[chave] = valor;
      } else if (typeof valor === "number" || typeof valor === "boolean") {
        custom_fields[chave] = String(valor);
      }
    }
  }

  const idDoCard = str(card.id);
  const evento = str(raiz.event);
  const source_metadata: Record<string, string> = { origem: ORIGEM_DESKCOMM };
  if (evento) source_metadata.deskcomm_evento = evento;
  if (idDoCard) source_metadata.deskcomm_card_id = idDoCard;

  return {
    name: str(contato.display_name) ?? str(contato.name) ?? str(card.title),
    phone: normalizePhoneBR(contato.phone_number),
    email: str(contato.email),
    custom_fields,
    source_metadata,
    externalId: idDoCard ? `deskcomm:${idDoCard}`.slice(0, 255) : null,
    etiquetasDoContato: etiquetasDoEnvio(contato.tags),
    etiquetasDoCard: etiquetasDoEnvio(card.tags),
  };
}
