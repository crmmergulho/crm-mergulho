/**
 * QUEM PODE USAR CAMPANHAS (personalização da Mergulho, 26/11/2026).
 *
 * No produto, toda rota de `/api/v1/campaigns` exige o papel Gerente. A SDR da
 * Mergulho é Atendente — escolha de 23/11: ela trabalha só com Fila e Minhas, sem
 * o Perdido na faixa e sem mexer em automações — e precisa montar e disparar
 * campanha. Promovê-la a Gerente desfaria essas escolhas; por isso o papel
 * mínimo das campanhas virou uma chave POR EMPRESA:
 *
 *   organizations.settings.campanhas_papel_minimo = 'agent' | 'manager'
 *
 * Ausente (ou inválida) = 'manager', o comportamento do produto. A chave só ABRE
 * para a Atendente — não endurece para cima. Só o CRM da SDR
 * (Grupo Mergulho) a liga em 'agent'; as unidades continuam com Gerente.
 *
 * A chave mora FORA de `settings.campanhas` de propósito: aquele objeto é regravado
 * inteiro pela tela Campanhas › Padrões (`configuracaoDeCampanhasSchema`), e uma
 * chave nova ali seria apagada na primeira vez que alguém salvasse os padrões.
 *
 * Isto só troca o PORTÃO das rotas. As gravações das campanhas já passam pelo
 * client admin com a organização do papel (a RLS de escrita é de Gerente), e as
 * leituras são da equipe inteira pela RLS. A proteção do número (ritmo, janela,
 * teto, aquecimento) não muda: quem dispara não decide a velocidade do número.
 *
 * Viewer nunca entra. A recusa passa pelo `requireRole` do papel exigido, então
 * sai a MESMA resposta 403 e a MESMA auditoria `authz.denied` de sempre.
 */
import { requireRole, type RoleCheck } from "@/lib/auth/require-role";
import { roleAtLeast, type Role } from "@/lib/auth/types";
import { createAdminClient } from "@/lib/supabase/admin";

export const PAPEL_PADRAO_DAS_CAMPANHAS: Role = "manager";

const PAPEIS_ACEITOS: readonly Role[] = ["agent", "manager"];

/** O papel mínimo gravado na empresa; qualquer coisa fora da lista vale o padrão. */
export function papelMinimoDasCampanhas(settings: unknown): Role {
  const valor =
    settings && typeof settings === "object"
      ? (settings as { campanhas_papel_minimo?: unknown }).campanhas_papel_minimo
      : undefined;
  return typeof valor === "string" && (PAPEIS_ACEITOS as readonly string[]).includes(valor)
    ? (valor as Role)
    : PAPEL_PADRAO_DAS_CAMPANHAS;
}

/**
 * O portão das rotas de campanha. Devolve o mesmo `RoleCheck` do `requireRole`,
 * para a rota seguir usando `authz.org.orgId` e `authz.user` como antes.
 */
export async function exigirPapelDeCampanhas(opts: { requestId: string }): Promise<RoleCheck> {
  // Piso: Atendente. Abaixo disso (viewer) a recusa é a de sempre.
  const piso = await requireRole("agent", { requestId: opts.requestId, resource: "campaigns" });
  if (!piso.ok) return piso;
  // Gerente e acima: o comportamento do produto, sem consulta extra.
  if (roleAtLeast(piso.org.role, PAPEL_PADRAO_DAS_CAMPANHAS)) return piso;

  // A organização vem do papel resolvido na sessão, nunca do pedido.
  const { data, error } = await createAdminClient()
    .from("organizations")
    .select("settings")
    .eq("id", piso.org.orgId)
    .maybeSingle();
  // Falha de leitura fecha a porta: vale o padrão (Gerente).
  const papel = error ? PAPEL_PADRAO_DAS_CAMPANHAS : papelMinimoDasCampanhas((data as { settings?: unknown } | null)?.settings);
  if (roleAtLeast(piso.org.role, papel)) return piso;

  // Recusa pelo caminho de sempre: 403 + `authz.denied` com o papel exigido.
  return requireRole(papel, { requestId: opts.requestId, resource: "campaigns" });
}
