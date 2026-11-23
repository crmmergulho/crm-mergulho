import { describe, expect, it } from "vitest";

import { ehEntradaDaPropriaInstalacao } from "./entrada-da-propria-instalacao";

const BASE = "https://crm.exemplo.com.br";
const ENTRADA = "https://crm.exemplo.com.br/api/v1/webhooks/in/AbC123_-xyz";

describe("ehEntradaDaPropriaInstalacao", () => {
  it("libera a entrada de dados do próprio CRM, pelo domínio público", () => {
    expect(ehEntradaDaPropriaInstalacao(ENTRADA, BASE)).toBe(true);
    expect(ehEntradaDaPropriaInstalacao(ENTRADA + "/", BASE)).toBe(true);
    expect(ehEntradaDaPropriaInstalacao("https://CRM.exemplo.com.br/api/v1/webhooks/in/abc", BASE)).toBe(true);
  });

  it("não libera nenhum outro caminho do próprio domínio", () => {
    expect(ehEntradaDaPropriaInstalacao("https://crm.exemplo.com.br/api/v1/health", BASE)).toBe(false);
    expect(ehEntradaDaPropriaInstalacao("https://crm.exemplo.com.br/api/v1/webhooks/in/", BASE)).toBe(false);
    expect(ehEntradaDaPropriaInstalacao("https://crm.exemplo.com.br/api/v1/webhooks/in/abc/outra", BASE)).toBe(false);
    // `../` é normalizado pelo URL antes da comparação: sai do caminho da entrada.
    expect(ehEntradaDaPropriaInstalacao("https://crm.exemplo.com.br/api/v1/webhooks/in/abc/../../admin/tenants", BASE)).toBe(false);
  });

  it("não libera outro domínio, http, outra porta nem credencial na URL", () => {
    expect(ehEntradaDaPropriaInstalacao("https://outro.com/api/v1/webhooks/in/abc", BASE)).toBe(false);
    expect(ehEntradaDaPropriaInstalacao("https://crm.exemplo.com.br.mal.com/api/v1/webhooks/in/abc", BASE)).toBe(false);
    expect(ehEntradaDaPropriaInstalacao("http://crm.exemplo.com.br/api/v1/webhooks/in/abc", BASE)).toBe(false);
    expect(ehEntradaDaPropriaInstalacao("https://crm.exemplo.com.br:8443/api/v1/webhooks/in/abc", BASE)).toBe(false);
    expect(ehEntradaDaPropriaInstalacao("https://user:senha@crm.exemplo.com.br/api/v1/webhooks/in/abc", BASE)).toBe(false);
  });

  it("sem endereço público configurado (ou não https), nada é liberado", () => {
    expect(ehEntradaDaPropriaInstalacao(ENTRADA, null)).toBe(false);
    expect(ehEntradaDaPropriaInstalacao(ENTRADA, "http://crm.exemplo.com.br")).toBe(false);
    expect(ehEntradaDaPropriaInstalacao("não é url", BASE)).toBe(false);
  });
});
