// Tipi allineati agli serializer DRF (`npm run api:generate` produce il client
// tipizzato completo da OpenAPI, se un giorno servira').

export type UUID = string
export type Money = string // Decimal serializzato: mai un number, mai float.

export interface User {
  id: UUID
  email: string
  display_name: string
  avatar: string | null
  email_verified_at?: string | null
  /** Lingua dell'interfaccia e delle mail ('it' | 'en'). */
  language?: string
}

export interface ListRef {
  id: UUID
  title: string
}

export interface IncludedList extends ListRef {
  event_date: string | null
  item_count: number
}

/** Chi e' (proprietario o membro di una lista): solo id e nome. */
export interface Person {
  id: UUID
  display_name: string
}

export interface WishList {
  id: UUID
  title: string
  description: string
  event_date: string | null
  /** Se falso il proprietario non vede cosa e' gia' stato regalato. */
  show_gifted: boolean
  share_token: string
  /** Il link `/unisciti/<token>` per scrivere la lista insieme; `null` se spento. */
  invite_token: string | null
  owner: Person
  /** Chi scrive la lista oltre al proprietario. */
  members: Person[]
  /** Chi guarda e' il proprietario (puo' eliminare, rigenerare il link, togliere gli altri). */
  is_owner: boolean
  /** Le liste incluse: i loro regali si vedono anche qui e nel link di questa. */
  included_lists: IncludedList[]
  /** Le liste che includono questa (allora non puo' includerne altre). */
  included_in: ListRef[]
  /** Regali di questa lista, senza quelli delle incluse. */
  item_count: number
  /** `null` finche' `show_gifted` e' spento: la sorpresa resta. */
  gifted_count: number | null
  created_at: string
  updated_at: string
}

export interface Wish {
  id: UUID
  title: string
  notes: string
  url: string
  price: Money | null
  /** Percorso della foto (`/media/...`), da passare a `mediaUrl`. */
  image: string | null
  /** `null` quando la lista nasconde le spunte al proprietario. */
  gifted: boolean | null
  gifted_by_name: string
  created_at: string
  updated_at: string
}

/** `image_id`: assente = foto invariata, `null` = toglila, id = quella caricata. */
export type WishPayload = Pick<Wish, 'title' | 'notes' | 'url' | 'price'> & {
  image_id?: UUID | null
}

export type IdeaStatus = 'idea' | 'bought' | 'given'

export interface GiftIdea {
  id: UUID
  recipient: string
  title: string
  notes: string
  url: string
  price: Money | null
  image: string | null
  occasion: string
  status: IdeaStatus
  created_at: string
  updated_at: string
}

export type GiftIdeaPayload = Omit<GiftIdea, 'id' | 'image' | 'created_at' | 'updated_at'> & {
  image_id?: UUID | null
}

/** Una foto appena caricata o presa da un link, da collegare con `image_id`. */
export interface GiftImage {
  id: UUID
  url: string
  width: number
  height: number
  source_url: string
}

/** Nome, prezzo e note proposti per il form (ADR 0006). */
export interface LinkDescription {
  title: string
  price: Money | null
  notes: string
}

/** Quello che si legge subito dal link di un regalo: i dati della pagina. */
export interface LinkDetails extends LinkDescription {
  image: GiftImage | null
  /** Perche' la foto non c'e', se il resto si e' letto. */
  image_error: string | null
  /** Da passare a `links/describe` per nome e note di Gemini; null se non si usa. */
  describe_id: string | null
}

/** L'anteprima di un invito a scrivere una lista insieme. */
export interface Invite {
  id: UUID
  title: string
  event_date: string | null
  owner_name: string
  member_count: number
  already_member: boolean
}

export interface SharedWish {
  id: UUID
  title: string
  notes: string
  url: string
  price: Money | null
  image: string | null
  gifted: boolean | null
  gifted_by_name: string
  /** Spuntato dall'utente loggato che guarda: puo' togliere la spunta. */
  mine: boolean
}

/** Una lista inclusa, come la vede chi ha il link di quella che la include. */
export interface SharedSection {
  id: UUID
  title: string
  event_date: string | null
  items: SharedWish[]
}

export interface SharedWishList {
  title: string
  description: string
  event_date: string | null
  owner_name: string
  is_owner: boolean
  items: SharedWish[]
  sections: SharedSection[]
}
