import { ArgumentsHost, Catch, ExceptionFilter } from '@nestjs/common';
import {
  PostValidationError,
  PostValidationException,
} from '@gitroom/nestjs-libraries/database/prisma/posts/posts.validation.exception';

@Catch(PostValidationException)
export class PostValidationExceptionFilter implements ExceptionFilter {
  catch(exception: PostValidationException, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();
    const status = exception.getStatus();
    const { provider, name, error } =
      exception.getResponse() as PostValidationError;

    response.status(status).json({
      statusCode: status,
      provider,
      name,
      message: error,
    });
  }
}
