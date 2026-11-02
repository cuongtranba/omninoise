import {
  validationMetadatasToSchemas,
  targetConstructorToSchema,
} from 'class-validator-jsonschema';
import { validate, ValidationError, ValidationTypes } from 'class-validator';
import { plainToInstance } from 'class-transformer';
// @ts-ignore
import { defaultMetadataStorage } from 'class-transformer/cjs/storage';

export function getValidationSchemas() {
  return validationMetadatasToSchemas({
    classTransformerMetadataStorage: defaultMetadataStorage,
    additionalConverters: {
      [ValidationTypes.NESTED_VALIDATION]: (meta, options) => {
        if (typeof meta.target === 'function') {
          const typeMeta = options.classTransformerMetadataStorage
            ? options.classTransformerMetadataStorage.findTypeMetadata(
                meta.target,
                meta.propertyName
              )
            : null;
          if (typeMeta) {
            const childType = typeMeta.typeFunction();
            return targetConstructorToSchema(childType, options);
          }
        }
        return {};
      },
    },
  });
}

const firstValidationError = (errors: ValidationError[]): string => {
  for (const error of errors) {
    if (error.constraints) {
      return Object.values(error.constraints)[0] || '';
    }
    const child = error.children?.length
      ? firstValidationError(error.children)
      : '';
    if (child) {
      return child;
    }
  }
  return '';
};

// The check the ValidationPipe of the web routes runs on a DTO, for the
// tools: the message of the first problem, or '' when the data is valid
export async function validateDto<T extends object>(
  dto: new () => T,
  data: object
): Promise<string> {
  const errors = await validate(plainToInstance(dto, data));
  return errors.length
    ? firstValidationError(errors) || 'The data is not valid'
    : '';
}
