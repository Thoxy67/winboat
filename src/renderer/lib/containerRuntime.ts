/**
 * Container Runtime Abstraction Layer
 * Provides a unified interface for Docker and Podman operations
 */

const { exec }: typeof import('child_process') = require('child_process');
const { promisify }: typeof import('util') = require('util');
const execAsync = promisify(exec);

export type RuntimeType = 'docker' | 'podman';

export interface ContainerRuntimeInfo {
    type: RuntimeType;
    version: string;
    composeInstalled: boolean;
    composeVersion?: string;
}

export class ContainerRuntime {
    private static detectedRuntime: RuntimeType | null = null;
    private static runtimeInfo: ContainerRuntimeInfo | null = null;

    /**
     * Detects which container runtime is available (Docker or Podman)
     * Checks if 'docker' command is actually Podman in disguise (podman-docker package)
     */
    static async detectRuntime(): Promise<RuntimeType | null> {
        if (this.detectedRuntime) {
            return this.detectedRuntime;
        }

        // Check if docker command exists and if it's actually podman
        try {
            const { stdout: dockerVersion } = await execAsync('docker --version');

            // If docker --version output contains "podman", it's the podman-docker wrapper
            if (dockerVersion.toLowerCase().includes('podman')) {
                console.log('[ContainerRuntime] Detected podman-docker wrapper');
                this.detectedRuntime = 'podman';
                return 'podman';
            }

            // Otherwise it's real Docker
            this.detectedRuntime = 'docker';
            return 'docker';
        } catch (e) {
            // Docker command not found, try podman directly
        }

        // Try Podman directly
        try {
            await execAsync('podman --version');
            this.detectedRuntime = 'podman';
            return 'podman';
        } catch (e) {
            // Neither found
        }

        return null;
    }

    /**
     * Gets detailed information about the detected container runtime
     */
    static async getRuntimeInfo(): Promise<ContainerRuntimeInfo | null> {
        const runtime = await this.detectRuntime();
        if (!runtime) return null;

        if (this.runtimeInfo && this.runtimeInfo.type === runtime) {
            return this.runtimeInfo;
        }

        const info: ContainerRuntimeInfo = {
            type: runtime,
            version: '',
            composeInstalled: false
        };

        try {
            const { stdout: versionOutput } = await execAsync(`${runtime} --version`);
            info.version = versionOutput.trim();

            // Check for compose support
            try {
                const { stdout: composeOutput } = await execAsync(`${runtime} compose version`);
                if (composeOutput) {
                    const versionMatch = composeOutput.match(/(\d+\.\d+\.\d+)/);
                    if (versionMatch) {
                        info.composeVersion = versionMatch[1];
                        const majorVersion = parseInt(versionMatch[1].split('.')[0], 10);
                        info.composeInstalled = majorVersion >= 2;
                    }
                }
            } catch (e) {
                info.composeInstalled = false;
            }

            this.runtimeInfo = info;
            return info;
        } catch (e) {
            console.error(`Error getting ${runtime} info:`, e);
            return null;
        }
    }

    /**
     * Gets the command prefix for the detected runtime
     */
    static async getCommand(): Promise<string> {
        const runtime = await this.detectRuntime();
        return runtime || 'docker'; // Fallback to docker for backward compatibility
    }

    /**
     * Executes a container command with the appropriate runtime
     */
    static async execCommand(command: string): Promise<{ stdout: string; stderr: string }> {
        const runtime = await this.getCommand();
        const fullCommand = command.replace(/^(docker|podman)/, runtime);
        return execAsync(fullCommand);
    }

    /**
     * Checks if the runtime is running and accessible
     */
    static async isRuntimeRunning(): Promise<boolean> {
        try {
            const runtime = await this.getCommand();
            const { stdout } = await execAsync(`${runtime} ps`);
            return !!stdout;
        } catch (e) {
            return false;
        }
    }

    /**
     * Checks if user is in the runtime group (docker/podman)
     * For Podman, this check is optional and always returns true
     * since Podman can run rootless without group membership
     */
    static async isUserInRuntimeGroup(): Promise<boolean> {
        try {
            const runtime = await this.detectRuntime();
            if (!runtime) return false;

            // Podman doesn't require group membership
            if (runtime === 'podman') {
                return true;
            }

            // Docker requires group membership
            const userGroups = (await execAsync('id -Gn')).stdout;
            return userGroups.split(/\s+/).includes('docker');
        } catch (e) {
            return false;
        }
    }

    /**
     * Checks if group membership is required for the detected runtime
     */
    static async requiresGroupMembership(): Promise<boolean> {
        const runtime = await this.detectRuntime();
        return runtime === 'docker';
    }

    /**
     * Resets the cached runtime detection (useful for testing)
     */
    static reset() {
        this.detectedRuntime = null;
        this.runtimeInfo = null;
    }

    /**
     * Container operations using the detected runtime
     */
    static async containerInspect(containerName: string, format: string): Promise<string> {
        const runtime = await this.getCommand();
        const { stdout } = await execAsync(`${runtime} inspect --format="${format}" ${containerName}`);
        return stdout.trim();
    }

    static async containerStart(containerName: string): Promise<string> {
        const runtime = await this.getCommand();
        const { stdout } = await execAsync(`${runtime} container start ${containerName}`);
        return stdout;
    }

    static async containerStop(containerName: string): Promise<string> {
        const runtime = await this.getCommand();
        const { stdout } = await execAsync(`${runtime} container stop ${containerName}`);
        return stdout;
    }

    static async containerPause(containerName: string): Promise<string> {
        const runtime = await this.getCommand();
        const { stdout } = await execAsync(`${runtime} container pause ${containerName}`);
        return stdout;
    }

    static async containerUnpause(containerName: string): Promise<string> {
        const runtime = await this.getCommand();
        const { stdout } = await execAsync(`${runtime} container unpause ${containerName}`);
        return stdout;
    }

    static async containerRemove(containerName: string): Promise<string> {
        const runtime = await this.getCommand();
        const { stdout } = await execAsync(`${runtime} rm ${containerName}`);
        return stdout;
    }

    static async volumeRemove(volumeName: string): Promise<string> {
        const runtime = await this.getCommand();
        const { stdout } = await execAsync(`${runtime} volume rm ${volumeName}`);
        return stdout;
    }

    static async containerList(filter?: string): Promise<string> {
        const runtime = await this.getCommand();
        const filterArg = filter ? `--filter "${filter}"` : '';
        const { stdout } = await execAsync(`${runtime} ps -a ${filterArg} --format "{{.Names}}"`);
        return stdout;
    }

    /**
     * Compose operations using the detected runtime
     */
    static async composeUp(composeFile: string): Promise<{ stdout: string; stderr: string }> {
        const runtime = await this.getCommand();
        return execAsync(`${runtime} compose -f ${composeFile} up -d`);
    }

    static async composeDown(composeFile: string): Promise<void> {
        const runtime = await this.getCommand();
        await execAsync(`${runtime} compose -f ${composeFile} down`);
    }

    /**
     * Gets Podman-specific network mode if using Podman
     * For Podman, we need to use 'pasta' or 'slirp4netns' instead of bridge for better rootless support
     */
    static async getNetworkMode(): Promise<string | undefined> {
        const runtime = await this.detectRuntime();
        if (runtime === 'podman') {
            // Use 'pasta' if available (Podman 4.4+), otherwise 'slirp4netns'
            try {
                const info = await this.getRuntimeInfo();
                if (info?.version && info.version.includes('4.4')) {
                    return 'pasta';
                }
                return 'slirp4netns';
            } catch {
                return 'slirp4netns';
            }
        }
        return undefined; // Docker doesn't need special network mode
    }
}
