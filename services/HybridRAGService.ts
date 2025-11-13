import { DEFAULT_HYBRID_STRATEGY, HybridStrategySettings, SyncMode } from '../settings/Settings';

export type HybridProcessingStage = () => Promise<void>;

export interface HybridExecutionRequest {
        mode: SyncMode;
        vectorStage?: HybridProcessingStage;
        graphStage?: HybridProcessingStage;
}

export class HybridRAGService {
        private strategy: HybridStrategySettings;

        constructor(strategy: HybridStrategySettings = DEFAULT_HYBRID_STRATEGY) {
                this.strategy = {
                        ...DEFAULT_HYBRID_STRATEGY,
                        ...strategy,
                };
        }

        public updateStrategy(strategy: Partial<HybridStrategySettings>): void {
                this.strategy = {
                        ...this.strategy,
                        ...strategy,
                };
        }

        public async execute(request: HybridExecutionRequest): Promise<void> {
                const { mode, vectorStage, graphStage } = request;
                const shouldRunVector = Boolean(vectorStage) && (mode === 'supabase' || mode === 'hybrid');
                const shouldRunGraph = Boolean(graphStage) && (mode === 'neo4j' || mode === 'hybrid');

                if (mode === 'hybrid' && this.strategy.requireDualWrites) {
                        if (!shouldRunVector || !shouldRunGraph) {
                                throw new Error('Hybrid mode is enabled but one of the stages is unavailable.');
                        }
                }

                const runVector = async () => {
                        if (shouldRunVector && vectorStage) {
                                await vectorStage();
                        }
                };
                const runGraph = async () => {
                        if (shouldRunGraph && graphStage) {
                                await graphStage();
                        }
                };

                if (shouldRunVector && shouldRunGraph) {
                        switch (this.strategy.executionOrder) {
                                case 'graph-first':
                                        await runGraph();
                                        await runVector();
                                        break;
                                case 'parallel':
                                        await Promise.all([runVector(), runGraph()]);
                                        break;
                                case 'vector-first':
                                default:
                                        await runVector();
                                        await runGraph();
                                        break;
                        }
                        return;
                }

                if (shouldRunVector) {
                        await runVector();
                } else if (shouldRunGraph) {
                        await runGraph();
                }
        }
}
