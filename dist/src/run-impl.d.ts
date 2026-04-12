export declare const ReportMethod: {
    readonly PullRequest: "pull-request";
    readonly Slack: "slack";
};
export type ReportMethodType = (typeof ReportMethod)[keyof typeof ReportMethod];
interface FuzzOptions {
    repository: string;
    githubToken: string;
    githubGraphqlUrl: string;
    githubServerUrl: string;
    githubRunId: string | undefined;
    githubRunAttempt: string | undefined;
    baseBranch: string;
    packages: string;
    workingDirectory: string;
    fuzzRegexp: string;
    fuzzTime: string;
    fuzzMinimizeTime: string;
    reportMethod: ReportMethodType;
    headBranchPrefix: string;
    webhookUrl: string;
    tags?: string;
}
interface SaveCacheOptions {
    packages: string;
    workingDirectory: string;
    fuzzRegexp: string;
}
interface FuzzResult {
    found: boolean;
    headBranch?: string;
    pullRequestNumber?: number;
    pullRequestUrl?: string;
}
export declare function fuzz(options: FuzzOptions): Promise<FuzzResult>;
export declare function restoreCache(options: SaveCacheOptions): Promise<void>;
export declare function saveCache(options: SaveCacheOptions): Promise<void>;
export {};
