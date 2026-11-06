import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { api } from '../lib/api'
import type {
  GiftIdea,
  GiftIdeaPayload,
  GiftImage,
  GiftSuggestion,
  Invite,
  LinkDescription,
  NotificationList,
  LinkDetails,
  SharedWish,
  SharedWishList,
  SuggestPayload,
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
  invite: (token: string) => ['invites', token] as const,
  notifications: ['notifications'] as const,
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

type ListPayload = Partial<
  Pick<WishList, 'title' | 'description' | 'event_date' | 'show_gifted'> & {
    /** Tutte le liste da includere, non la differenza. */
    included_list_ids: UUID[]
  }
>

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

/* ------------------------------------------------- scrivere la lista insieme -- */

/** `true` crea (o rinnova) il link d'invito, `false` lo spegne. */
export function useInviteLink(listId: UUID) {
  const client = useQueryClient()
  const url = `/api/lists/${listId}/invite-link`
  return useMutation({
    mutationFn: (enable: boolean) => (enable ? api.post<WishList>(url) : api.delete<WishList>(url)),
    onSuccess: () => client.invalidateQueries({ queryKey: keys.lists }),
  })
}

/** Toglie un membro (il proprietario) o se stesso (un membro che esce). */
export function useRemoveMember(listId: UUID) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (userId: UUID) =>
      api.delete<WishList | void>(`/api/lists/${listId}/members/${userId}`),
    onSuccess: () => client.invalidateQueries({ queryKey: keys.lists }),
  })
}

export function useInvite(token: string) {
  return useQuery({
    queryKey: keys.invite(token),
    queryFn: () => api.get<Invite>(`/api/invites/${token}`),
    retry: false,
  })
}

export function useAcceptInvite(token: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: () => api.post<WishList>(`/api/invites/${token}`),
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

/* --------------------------------------------------------- prezzi e avvisi -- */

/** La campanella su un regalo della propria lista: `watch` vero la mette. */
export function useWatchWish(listId: UUID) {
  const invalidate = useListInvalidation()
  return useMutation({
    mutationFn: ({ id, watch }: { id: UUID; watch: boolean }) => {
      const url = `/api/lists/${listId}/items/${id}/watch`
      return watch ? api.post<Wish>(url) : api.delete<Wish>(url)
    },
    onSuccess: invalidate,
  })
}

export function useWatchIdea() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: ({ id, watch }: { id: UUID; watch: boolean }) => {
      const url = `/api/ideas/${id}/watch`
      return watch ? api.post<GiftIdea>(url) : api.delete<GiftIdea>(url)
    },
    onSuccess: () => client.invalidateQueries({ queryKey: keys.ideas }),
  })
}

/** La campanella di chi ha il link (serve un account). */
export function useWatchSharedWish(token: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: ({ id, watch }: { id: UUID; watch: boolean }) => {
      const url = `/api/shared/${token}/items/${id}/watch`
      return watch ? api.post<SharedWish>(url) : api.delete<SharedWish>(url)
    },
    onSuccess: () => client.invalidateQueries({ queryKey: keys.shared(token) }),
  })
}

/** Gli avvisi dell'utente; si rileggono da soli ogni minuto per il contatore. */
export function useNotifications(enabled: boolean) {
  return useQuery({
    queryKey: keys.notifications,
    queryFn: () => api.get<NotificationList>('/api/notifications'),
    enabled,
    refetchInterval: 60_000,
  })
}

export function useMarkNotificationsRead() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: () => api.post<void>('/api/notifications'),
    onSuccess: () => client.invalidateQueries({ queryKey: keys.notifications }),
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

/** "Ispirami": idee regalo da Gemini per una persona. */
export function useSuggestGifts() {
  return useMutation({
    mutationFn: (body: SuggestPayload) => api.post<GiftSuggestion[]>('/api/ideas/suggest', body),
  })
}

/** Alternative a un regalo gia' preso, dal link condiviso. */
export function useSharedSuggest(token: string) {
  return useMutation({
    mutationFn: (body: { item_id: UUID; exclude?: string[] }) =>
      api.post<GiftSuggestion[]>(`/api/shared/${token}/suggest`, body),
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
