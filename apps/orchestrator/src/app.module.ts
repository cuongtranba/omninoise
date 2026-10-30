import { Module } from '@nestjs/common';
import { PostActivity } from '@gitroom/orchestrator/activities/post.activity';
import { DatabaseModule } from '@gitroom/nestjs-libraries/database/prisma/database.module';
import { AutopostActivity } from '@gitroom/orchestrator/activities/autopost.activity';
import { EmailActivity } from '@gitroom/orchestrator/activities/email.activity';
import { IntegrationsActivity } from '@gitroom/orchestrator/activities/integrations.activity';
import { VideoActivity } from '@gitroom/orchestrator/activities/video.activity';
import { MediaActivity } from '@gitroom/orchestrator/activities/media.activity';
import { ClippingActivity } from '@gitroom/orchestrator/activities/clipping.activity';
import { VideoModule } from '@gitroom/nestjs-libraries/videos/video.module';
import { HealthController } from '@gitroom/orchestrator/health.controller';
import { JobsModule } from '@gitroom/nestjs-libraries/jobs/job.queue';
import { PostJobs } from '@gitroom/orchestrator/jobs/post.jobs';
import { SystemJobs } from '@gitroom/orchestrator/jobs/system.jobs';
import { EmailMediaJobs } from '@gitroom/orchestrator/jobs/email.media.jobs';
import { ClippingJobs } from '@gitroom/orchestrator/jobs/clipping.jobs';
import { JobSeeder } from '@gitroom/orchestrator/jobs/job.seeder';
import { JobWorkerService } from '@gitroom/orchestrator/jobs/job.worker.service';

// The services the job handlers call; plain injectables, not workers.
const activities = [
  PostActivity,
  AutopostActivity,
  EmailActivity,
  IntegrationsActivity,
  VideoActivity,
  MediaActivity,
  ClippingActivity,
];
const jobs = [
  PostJobs,
  SystemJobs,
  EmailMediaJobs,
  ClippingJobs,
  JobSeeder,
  JobWorkerService,
];
@Module({
  imports: [DatabaseModule, VideoModule, JobsModule],
  controllers: [HealthController],
  providers: [...activities, ...jobs],
  get exports() {
    return [...this.providers, ...this.imports];
  },
})
export class AppModule {}
