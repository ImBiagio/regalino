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

export interface WishList {
  id: UUID
  title: string
  description: string
  event_date: string | null
  /** Se falso il proprietario non vede cosa e' gia' stato regalato. */
  show_gifted: boolean
  share_token: string
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

/** Quello che si legge dal link di un regalo (ADR 0006): proposte per il form. */
export interface LinkDetails {
  title: string
  price: Money | null
  notes: string
  image: GiftImage | null
  /** Perche' la foto non c'e', se il resto si e' letto. */
  image_error: string | null
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

export interface SharedWishList {
  title: string
  description: string
  event_date: string | null
  owner_name: string
  is_owner: boolean
  items: SharedWish[]
}
