/**
 * A ENTRADA DE DADOS DA PRÓPRIA INSTALAÇÃO como destino de "Avisar outro
 * sistema" (personalização da Mergulho, nov/2026).
 *
 * ═══ O defeito, medido ═══
 *
 * O CRM da SDR manda o card para o CRM da unidade, na MESMA instalação, pela
 * ação `call_webhook` apontada para `https://<domínio do CRM>/api/v1/webhooks/in/<token>`.
 * Dentro do compose, o domínio público resolve para o IP PRIVADO do proxy
 * reverso (alias da rede do Docker: `crm.<domínio>` → `172.20.0.x`), e
 * `assertDestinoResolvidoSeguro` recusa com `unsafe_url:private_ip`. Medido em
 * 23/11/2026: o envio falhou e nada chegou à unidade.
 *
 * ═══ Por que a exceção não abre nada ═══
 *
 * A recusa por IP interno protege a rede de dentro (metadata da nuvem, banco,
 * WAHA). Este destino NÃO é a rede de dentro: é o endpoint PÚBLICO de entrada
 * de dados do próprio CRM, que já recebe da internet protegido pelo token do
 * caminho e pela assinatura. Chegar a ele pelo proxy é exatamente o caminho de
 * quem vem de fora. Por isso a exceção é estreita e conferida campo a campo:
 *   - https, sem usuário nem senha na URL;
 *   - o MESMO host e a MESMA porta do endereço público da instalação
 *     (`NEXT_PUBLIC_APP_URL`, lido por `basePublicaConfiguradaDaInstalacao`);
 *   - e só o caminho `/api/v1/webhooks/in/<token>` — nenhum outro.
 * Qualquer outra coisa segue a régua de sempre.
 */
import { basePublicaConfiguradaDaInstalacao } from "@/lib/webhooks/url-publica";

const CAMINHO_DA_ENTRADA = /^\/api\/v1\/webhooks\/in\/[A-Za-z0-9_-]+\/?$/;

export function ehEntradaDaPropriaInstalacao(
  url: string,
  base: string | null = basePublicaConfiguradaDaInstalacao({ aceitarMaquinaLocal: false }),
): boolean {
  if (!base) return false;
  let alvo: URL;
  let propria: URL;
  try {
    alvo = new URL(url);
    propria = new URL(base);
  } catch {
    return false;
  }
  if (alvo.protocol !== "https:" || propria.protocol !== "https:") return false;
  if (alvo.username || alvo.password) return false;
  if (alvo.hostname.toLowerCase() !== propria.hostname.toLowerCase()) return false;
  if (alvo.port !== propria.port) return false;
  return CAMINHO_DA_ENTRADA.test(alvo.pathname);
}
