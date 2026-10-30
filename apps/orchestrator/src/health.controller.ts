import { Controller, Get, Res } from '@nestjs/common';
import { Response } from 'express';
import { getPgPool } from '@gitroom/nestjs-libraries/pg/pg.pool';

@Controller('health')
export class HealthController {
  @Get('/status')
  async getHealthStatus(@Res() res: Response) {
    try {
      await Promise.race([
        getPgPool().query('SELECT 1'),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('timeout')), 10000)
        ),
      ]);
      return res.status(200).json({ status: 'ok' });
    } catch {
      return res.status(500).json({ status: 'error' });
    }
  }
}
