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
  /** Dove arrivano gli avvisi (prezzo sceso): nell'app, per email o entrambi. */
  notify_by?: NotifyBy
}

export type NotifyBy = 'app' | 'email' | 'both'

/** Un prezzo visto sul link in una data (ADR 0011). */
export interface PricePoint {
  at: string
  price: Money
}

export interface Notification {
  id: UUID
  title: string
  body: string
  url: string
  read_at: string | null
  created_at: string
}

export interface NotificationList {
  unread: number
  items: Notification[]
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
  gtin: string
  brand: string
  /** "Va con" un altro regalo della lista: si spunta solo dopo quello (ADR 0009). */
  requires_id: UUID | null
  requires_title: string
  price_history: PricePoint[]
  /** Chi guarda ha messo la campanella. */
  watching: boolean
  /** `null` quando la lista nasconde le spunte al proprietario. */
  gifted: boolean | null
  gifted_by_name: string
  created_at: string
  updated_at: string
}

/** `image_id`: assente = foto invariata, `null` = toglila, id = quella caricata. */
export type WishPayload = Pick<Wish, 'title' | 'notes' | 'url' | 'price' | 'gtin' | 'brand'> & {
  image_id?: UUID | null
  requires_id?: UUID | null
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
  gtin: string
  brand: string
  occasion: string
  status: IdeaStatus
  price_history: PricePoint[]
  watching: boolean
  created_at: string
  updated_at: string
}

export type GiftIdeaPayload = Omit<
  GiftIdea,
  'id' | 'image' | 'price_history' | 'watching' | 'created_at' | 'updated_at'
> & {
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
  /** Codice a barre (EAN/ISBN) e marca dichiarati: per "Dove trovarlo". */
  gtin: string
  brand: string
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

/** Un'idea regalo scritta da Gemini (ADR 0010). */
export interface GiftSuggestion {
  title: string
  why: string
  /** Prezzo indicativo, solo il numero, o vuoto. */
  price: string
  /** Parole per cercarlo in un negozio. */
  query: string
}

/** Cosa il wizard "Ispirami" sa della persona. Tutto facoltativo. */
export interface SuggestPayload {
  recipient: string
  relation: string
  age: string
  interests: string[]
  avoid: string
  occasion: string
  budget_min: string
  budget_max: string
  exclude?: string[]
}

export interface SharedWish {
  id: UUID
  title: string
  notes: string
  url: string
  price: Money | null
  image: string | null
  gtin: string
  brand: string
  /** Il regalo con cui va (stessa lista): "Lo regalo io" solo dopo quello. */
  requires_id: UUID | null
  price_history: PricePoint[]
  watching: boolean
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
