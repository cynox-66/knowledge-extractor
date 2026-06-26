/**
 * Represents the creator, publisher, or originator of a resource.
 */
export interface IAuthor {
  /**
   * A unique identifier for the author within the context of the provider.
   */
  externalId?: string;
  /**
   * The handle or username of the author (e.g., "@johndoe").
   */
  handle: string;
  /**
   * The human-readable display name of the author.
   */
  displayName?: string;
  /**
   * The URI pointing to the author's avatar or profile picture.
   */
  avatarUri?: string;
  /**
   * The URI pointing to the author's profile page on the provider's platform.
   */
  profileUri?: string;
}
