import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { api } from '../lib/api'
import type {
  GiftIdea,
  GiftIdeaPayload,
  GiftImage,
  LinkDescription,
  LinkDetails,
  SharedWish,
  SharedWishList,
  UUID,
  Wish,
  WishList,
  WishPayload,
} from '../lib/types'

export const keys = {
  lists: ['lists'] as const,
  list: (id: UUID) => ['lists', id] as const,
  items: (id: UUID) => ['lists', id, 'items'] as const,
  ideas: ['ideas'] as const,
  shared: (token: string) => ['shared', token] as const,
}

/* ------------------------------------------------------------ le mie liste -- */

export function useLists() {
  return useQuery({
    queryKey: keys.lists,
    queryFn: () => api.get<WishList[]>('/api/lists'),
  })
}

export function useList(listId: UUID | undefined) {
  return useQuery({
    queryKey: keys.list(listId!),
    queryFn: () => api.get<WishList>(`/api/lists/${listId}`),
    enabled: Boolean(listId),
  })
}

type ListPayload = Partial<Pick<WishList, 'title' | 'description' | 'event_date' | 'show_gifted'>>

/** PATCH se c'e' l'id, altrimenti POST: la stessa mutation crea e modifica. */
export function useSaveList() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...body }: ListPayload & { id?: UUID }) =>
      id ? api.patch<WishList>(`/api/lists/${id}`, body) : api.post<WishList>('/api/lists', body),
    // Anche i regali: cambiare "mostrami cosa e' stato regalato" cambia cosa arriva.
    onSuccess: () => client.invalidateQueries({ queryKey: keys.lists }),
  })
}

export function useDeleteList() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (id: UUID) => api.delete<void>(`/api/lists/${id}`),
    onSuccess: (_data, id) => {
      client.removeQueries({ queryKey: keys.list(id) })
      return client.invalidateQueries({ queryKey: keys.lists, exact: true })
    },
  })
}

export function useRegenerateLink(listId: UUID) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: () => api.post<WishList>(`/api/lists/${listId}/regenerate-link`),
    onSuccess: () => client.invalidateQueries({ queryKey: keys.lists }),
  })
}

export function useWishes(listId: UUID) {
  return useQuery({
    queryKey: keys.items(listId),
    queryFn: () => api.get<Wish[]>(`/api/lists/${listId}/items`),
  })
}

/** Ogni scrittura su un regalo cambia anche i contatori della lista. */
function useListInvalidation() {
  const client = useQueryClient()
  return () => client.invalidateQueries({ queryKey: keys.lists })
}

export function useSaveWish(listId: UUID) {
  const invalidate = useListInvalidation()
  const base = `/api/lists/${listId}/items`
  return useMutation({
    mutationFn: ({ id, ...body }: Partial<WishPayload> & { id?: UUID }) =>
      id ? api.patch<Wish>(`${base}/${id}`, body) : api.post<Wish>(base, body),
    onSuccess: invalidate,
  })
}

export function useDeleteWish(listId: UUID) {
  const invalidate = useListInvalidation()
  return useMutation({
    mutationFn: (id: UUID) => api.delete<void>(`/api/lists/${listId}/items/${id}`),
    onSuccess: invalidate,
  })
}

/** Toglie una spunta sbagliata (solo con "mostrami cosa e' stato regalato"). */
export function useClearGift(listId: UUID) {
  const invalidate = useListInvalidation()
  return useMutation({
    mutationFn: (id: UUID) => api.delete<Wish>(`/api/lists/${listId}/items/${id}/gift`),
    onSuccess: invalidate,
  })
}

/* ------------------------------------------------------------------- foto -- */

/** Foto dal dispositivo: torna l'id da mettere in `image_id` al salvataggio. */
export function useUploadImage() {
  return useMutation({
    mutationFn: (file: File) => {
      const form = new FormData()
      form.append('file', file)
      return api.post<GiftImage>('/api/images', form)
    },
  })
}

/** Foto da un link: un'immagine diretta o la pagina del negozio (og:image). */
export function useImageFromUrl() {
  return useMutation({
    mutationFn: (url: string) => api.post<GiftImage>('/api/images/from-url', { url }),
  })
}

/** Nome, prezzo, note e foto dal link del negozio, per compilare il form. */
export function useReadLink() {
  return useMutation({
    mutationFn: (body: { url: string; image: boolean }) =>
      api.post<LinkDetails>('/api/links/read', body),
  })
}

/** Nome, prezzo e note scritti da Gemini: arrivano dopo, anche decine di secondi. */
export function useDescribeLink() {
  return useMutation({
    mutationFn: (describeId: string) =>
      api.post<LinkDescription>('/api/links/describe', { describe_id: describeId }),
  })
}

/* ------------------------------------------------------------ da regalare -- */

export function useIdeas() {
  return useQuery({
    queryKey: keys.ideas,
    queryFn: () => api.get<GiftIdea[]>('/api/ideas'),
  })
}

export function useSaveIdea() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...body }: Partial<GiftIdeaPayload> & { id?: UUID }) =>
      id ? api.patch<GiftIdea>(`/api/ideas/${id}`, body) : api.post<GiftIdea>('/api/ideas', body),
    onSuccess: () => client.invalidateQueries({ queryKey: keys.ideas }),
  })
}

export function useDeleteIdea() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (id: UUID) => api.delete<void>(`/api/ideas/${id}`),
    onSuccess: () => client.invalidateQueries({ queryKey: keys.ideas }),
  })
}

/* ------------------------------------------------------- lista condivisa -- */

/**
 * `viewer` e' l'utente loggato (o `null`): la risposta cambia se chi guarda e'
 * il proprietario, quindi la query aspetta che la sessione sia ripresa.
 */
export function useSharedList(token: string, viewer: UUID | null, ready: boolean) {
  return useQuery({
    queryKey: [...keys.shared(token), viewer] as const,
    queryFn: () => api.get<SharedWishList>(`/api/shared/${token}`),
    enabled: ready,
    retry: false,
    // Chi ha il link apre la lista mentre altri spuntano: meglio dati freschi.
    refetchOnWindowFocus: true,
  })
}

const CLAIMS_KEY = 'regalino.claims'

/**
 * Le chiavi dei regali spuntati da questo browser: servono a togliere la spunta
 * senza account. Se lo storage non c'e' (navigazione privata) si spunta lo
 * stesso, solo che poi non si puo' annullare da qui.
 */
export function readClaims(): Record<UUID, string> {
  try {
    return JSON.parse(localStorage.getItem(CLAIMS_KEY) ?? '{}') as Record<UUID, string>
  } catch {
    return {}
  }
}

function writeClaims(claims: Record<UUID, string>) {
  try {
    localStorage.setItem(CLAIMS_KEY, JSON.stringify(claims))
  } catch {
    // Storage pieno o bloccato: la spunta resta valida sul server.
  }
}

export function useClaimGift(token: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: ({ id, name }: { id: UUID; name: string }) =>
      api.post<{ claim_key: string; item: SharedWish }>(`/api/shared/${token}/items/${id}/gift`, {
        name,
      }),
    onSuccess: (data, { id }) => {
      writeClaims({ ...readClaims(), [id]: data.claim_key })
      return client.invalidateQueries({ queryKey: keys.shared(token) })
    },
    onError: () => client.invalidateQueries({ queryKey: keys.shared(token) }),
  })
}

export function useReleaseGift(token: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (id: UUID) =>
      api.delete<SharedWish>(`/api/shared/${token}/items/${id}/gift`, {
        claim_key: readClaims()[id] ?? '',
      }),
    onSuccess: (_data, id) => {
      const claims = readClaims()
      delete claims[id]
      writeClaims(claims)
      return client.invalidateQueries({ queryKey: keys.shared(token) })
    },
  })
}
