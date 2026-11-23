/**
 * Mergulho (18/11/2026): a barra do Inbox SEM "Automático" e SEM "Grupos".
 *
 * Sem `vi.mock` de `lib/inbox/abas-da-mergulho`: é a configuração que vai para
 * a imagem. Os outros testes da barra ligam as duas chaves para seguir
 * exercitando o produto.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { InboxFilters, visibleInboxTabs, type InboxFiltersValue } from "@/components/inbox/InboxFilters";
import type { ActiveOrg } from "@/lib/auth/types";

const activeOrgRef: { current: ActiveOrg | null } = { current: null };

vi.mock("@/hooks/auth/AuthProvider", () => ({
  useAuth: () => ({ activeOrg: activeOrgRef.current }),
}));
vi.mock("@/hooks/channels/useChannelSessions", () => ({
  useChannelSessions: () => ({ data: [] }),
  channelLabel: () => "canal",
}));
vi.mock("@/hooks/inbox/useConversationTags", () => ({
  useConversationTagVocabulary: () => ({ data: [] }),
}));
vi.mock("@/hooks/contacts/useContactTagVocabulary", () => ({
  useContactTagVocabulary: () => ({ data: [] }),
}));
vi.mock("@/hooks/inbox/useConversationCounts", () => ({
  useConversationCounts: () => ({
    data: { fila: 3, mine: 2, all: 5, automatico: 7, closed: 4, archived: 1 },
  }),
}));

const VALUE: InboxFiltersValue = { tab: "unassigned", search: "", onlyUnread: false };

beforeEach(() => {
  activeOrgRef.current = { orgId: "org-1", name: "Org", role: "admin", visibility_mode: "all" };
});
afterEach(cleanup);

describe("barra do Inbox da Mergulho", () => {
  it("as abas são Fila, Minhas, Todas, Fechadas e Arquivadas — sem Automático", () => {
    render(<InboxFilters value={VALUE} onChange={() => {}} />);
    const abas = screen.getAllByRole("tab").map((el) => (el.textContent ?? "").replace(/\d+$/, "").trim());
    expect(abas).toEqual(["Fila", "Minhas", "Todas", "Fechadas", "Arquivadas"]);
  });

  it("a regra pura também não devolve a aba do automático, para nenhum papel", () => {
    expect(visibleInboxTabs("admin", "all")).not.toContain("ai");
    expect(visibleInboxTabs("agent", "own_and_unassigned")).toEqual(["unassigned", "mine"]);
  });

  it("a Atendente não vê Fechadas nem Arquivadas; a administradora vê", () => {
    expect(visibleInboxTabs("agent", "all")).toEqual(["unassigned", "mine", "all"]);
    expect(visibleInboxTabs("admin", "all")).toEqual(["unassigned", "mine", "all", "closed", "archived"]);
    expect(visibleInboxTabs("manager", "own_and_unassigned")).toContain("closed");
  });

  it("na tela, a Atendente vê só Fila e Minhas", () => {
    activeOrgRef.current = { orgId: "org-1", name: "Org", role: "agent", visibility_mode: "own_and_unassigned" };
    render(<InboxFilters value={VALUE} onChange={() => {}} />);
    const abas = screen.getAllByRole("tab").map((el) => (el.textContent ?? "").replace(/\d+$/, "").trim());
    expect(abas).toEqual(["Fila", "Minhas"]);
  });

  it("não há botão Grupos; Não lidos continua", () => {
    render(<InboxFilters value={VALUE} onChange={() => {}} />);
    expect(screen.queryByRole("button", { name: "Grupos" })).toBeNull();
    expect(screen.getByRole("button", { name: "Não lidos" })).toBeTruthy();
  });
});
