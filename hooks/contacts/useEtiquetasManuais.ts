"use client";
import { useQuery } from "@tanstack/react-query";

import { apiClient } from "@/lib/api/client";

/** O que `/api/v1/contact-tags/manuais` devolve. */
export interface EtiquetasManuais {
  /** As que se põem à mão: a lista do editor com o campo vazio. */
  manuais: string[];
  /** As que as regras põem ou tiram do contato: o editor não as sugere. */
  automaticas: string[];
}

/**
 * As etiquetas manuais e as automáticas do contato (personalização da Mergulho,
 * nov/2026). Mora num arquivo próprio, e não ao lado de `useContactTagVocabulary`,
 * porque os testes do editor substituem aquele módulo inteiro por um dublê.
 * Falha (ou ainda carregando) devolve `undefined`, e o editor segue com as
 * sugestões de antes.
 */
export function useEtiquetasManuais(orgId: string | null) {
  return useQuery({
    queryKey: ["contact-tags-manuais", orgId],
    enabled: !!orgId,
    staleTime: 5 * 60_000,
    retry: false,
    queryFn: async ({ signal }): Promise<EtiquetasManuais> => {
      const res = await apiClient.get<{ data: EtiquetasManuais }>("/api/v1/contact-tags/manuais", { signal });
      return res.data;
    },
  });
}
