import { AgentToolInterface } from '@gitroom/nestjs-libraries/chat/agent.tool.interface';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { Injectable } from '@nestjs/common';
import { SignatureService } from '@gitroom/nestjs-libraries/database/prisma/signatures/signature.service';
import { SignatureDto } from '@gitroom/nestjs-libraries/dtos/signature/signature.dto';
import {
  checkAuth,
  toolErrorMessage,
} from '@gitroom/nestjs-libraries/chat/auth.context';
import { validateDto } from '@gitroom/nestjs-libraries/chat/validation.schemas.helper';

const signatureSchema = z.object({
  id: z.string(),
  content: z.string(),
  autoAdd: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const toSignature = (signature: {
  id: string;
  content: string;
  autoAdd: boolean;
  createdAt: Date;
  updatedAt: Date;
}) => ({
  id: signature.id,
  content: signature.content,
  autoAdd: signature.autoAdd,
  createdAt: signature.createdAt.toISOString(),
  updatedAt: signature.updatedAt.toISOString(),
});

@Injectable()
export class SignaturesTool implements AgentToolInterface {
  constructor(private _signatureService: SignatureService) {}
  name = 'signaturesTool';
  mirrors = [
    'GET /signatures',
    'GET /signatures/default',
    'POST /signatures',
    'PUT /signatures/:id',
    'DELETE /signatures/:id',
  ];
  optionalOnSelfHosted = true;

  run() {
    return createTool({
      id: 'signaturesTool',
      mcp: {
        annotations: {
          title: 'Manage Signatures',
          readOnlyHint: false,
          destructiveHint: true,
          idempotentHint: false,
          openWorldHint: false,
        },
      },
      description: `
Use this to manage the signatures of the organization: a text (HTML, written like the content of a post) that can be added at the end of a post. The one with "autoAdd" true is the default signature, which the editor adds to every new post by itself; only one signature can be the default, saving one with autoAdd true makes the others stop being it.
action "list": all the signatures.
action "getDefault": the default signature, "signature" is null when there is none.
action "create": saves a new signature, pass "content" and "autoAdd".
action "update": changes the signature with the given "id" (list them first to get it), pass "content" and "autoAdd" again, they replace the saved ones.
action "delete": removes the signature with the given "id". It cannot be undone, so show the user which signature will be deleted and get their confirmation first.
If something fails, the result contains output.errors.
`,
      inputSchema: z.object({
        action: z.enum(['list', 'getDefault', 'create', 'update', 'delete']),
        id: z
          .string()
          .optional()
          .describe('For "update" and "delete": the "id" of the signature'),
        content: z
          .string()
          .optional()
          .describe('For "create" and "update": the signature, as HTML'),
        autoAdd: z
          .boolean()
          .optional()
          .describe(
            'For "create" and "update": true to make it the default signature'
          ),
      }),
      outputSchema: z.object({
        output: z
          .object({ signatures: z.array(signatureSchema) })
          .or(z.object({ signature: signatureSchema.nullable() }))
          .or(z.object({ saved: z.object({ id: z.string() }) }))
          .or(z.object({ deleted: z.object({ id: z.string() }) }))
          .or(z.object({ errors: z.string() })),
      }),
      execute: async (inputData, context) => {
        checkAuth(inputData, context);
        const organizationId = JSON.parse(
          (context?.requestContext as any)?.get('organization') as string
        ).id;

        try {
          if (inputData.action === 'list') {
            return {
              output: {
                signatures: (
                  await this._signatureService.getSignaturesByOrgId(
                    organizationId
                  )
                ).map(toSignature),
              },
            };
          }

          if (inputData.action === 'getDefault') {
            const signature = await this._signatureService.getDefaultSignature(
              organizationId
            );
            return {
              output: { signature: signature ? toSignature(signature) : null },
            };
          }

          if (inputData.action === 'delete') {
            if (!inputData.id) {
              return { output: { errors: 'The id is required' } };
            }
            await this._signatureService.deleteSignature(
              organizationId,
              inputData.id
            );
            return { output: { deleted: { id: inputData.id } } };
          }

          const body = {
            content: inputData.content,
            autoAdd: inputData.autoAdd,
          } as SignatureDto;
          const invalid = await validateDto(SignatureDto, body);
          if (invalid) {
            return { output: { errors: invalid } };
          }

          if (inputData.action === 'update' && !inputData.id) {
            return { output: { errors: 'The id is required' } };
          }

          return {
            output: {
              saved: await this._signatureService.createOrUpdateSignature(
                organizationId,
                body,
                inputData.action === 'update' ? inputData.id : undefined
              ),
            },
          };
        } catch (err: any) {
          return {
            output: {
              errors: toolErrorMessage(
                err,
                'The signature was not found',
                'Failed to manage the signatures'
              ),
            },
          };
        }
      },
    });
  }
}
