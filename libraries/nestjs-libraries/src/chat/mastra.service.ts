import { Mastra } from '@mastra/core/mastra';
import { ConsoleLogger } from '@mastra/core/logger';
import { pStore } from '@gitroom/nestjs-libraries/chat/mastra.store';
import { forwardRef, Inject, Injectable, Logger } from '@nestjs/common';
import { LoadToolsService } from '@gitroom/nestjs-libraries/chat/load.tools.service';

@Injectable()
export class MastraService {
  static mastra: Mastra;
  // forwardRef: the tools use this service, which closes an import cycle
  constructor(
    @Inject(forwardRef(() => LoadToolsService))
    private _loadToolsService: LoadToolsService
  ) {}
  async mastra() {
    MastraService.mastra =
      MastraService.mastra ||
      new Mastra({
        storage: pStore,
        agents: {
          postiz: await this._loadToolsService.agent(),
        },
        logger: new ConsoleLogger({
          level: 'info',
        }),
      });

    return MastraService.mastra;
  }

  // The chat history of the in-app agent. The threads belong to the
  // organization (the resourceId) and every member of it sees the same list.
  async listThreads(organizationId: string) {
    const memory = await (await this.mastra()).getAgent('postiz').getMemory();
    const list = await memory.listThreads({
      filter: { resourceId: organizationId },
      perPage: 100000,
      page: 0,
      orderBy: { field: 'createdAt', direction: 'DESC' },
    });

    return {
      threads: list.threads.map((p) => ({
        id: p.id,
        title: p.title,
      })),
    };
  }

  async threadMessages(organizationId: string, threadId: string): Promise<any> {
    const memory = await (await this.mastra()).getAgent('postiz').getMemory();
    try {
      return await memory.recall({
        resourceId: organizationId,
        threadId,
      });
    } catch (err) {
      Logger.warn(`Could not recall messages for thread ${threadId}: ${err}`);
      return { messages: [] };
    }
  }
}
