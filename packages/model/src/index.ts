export interface ModelAppSummary {
  appmoduleid: string;
  uniquename?: string;
  name?: string;
}

export class ModelService {
  summarize(app: ModelAppSummary): string {
    return app.name ?? app.uniquename ?? app.appmoduleid;
  }
}
