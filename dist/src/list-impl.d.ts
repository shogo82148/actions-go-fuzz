interface FuzzTest {
    package: string;
    func: string;
}
interface ListOptions {
    packages: string[];
    workingDirectory: string;
    tags?: string;
}
interface ListResult {
    fuzzTests: FuzzTest[];
}
export declare function list(options: ListOptions): Promise<ListResult>;
export {};
