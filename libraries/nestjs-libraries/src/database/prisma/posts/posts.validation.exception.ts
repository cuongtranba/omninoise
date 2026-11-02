import { HttpException, HttpStatus } from '@nestjs/common';

export type PostValidationError = {
  /** Provider identifier, e.g. "x", "linkedin-page". */
  provider: string;
  /** Human readable provider name, e.g. "X", "LinkedIn Page". */
  name: string;
  /** The readable validation error. */
  error: string;
  /** Which rule failed, for callers that word the error themselves. */
  reason: 'emptyContent' | 'settings' | 'media' | 'tooLong';
  /** Set when reason is tooLong. */
  maximumCharacters?: number;
};

export class PostValidationException extends HttpException {
  constructor(message: PostValidationError) {
    super(message, HttpStatus.BAD_REQUEST);
  }
}
