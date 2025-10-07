import { getFreeRDP } from '../utils/getFreeRDP';
import { ContainerRuntime } from './containerRuntime';
const fs: typeof import('fs') = require('fs');
const os: typeof import('os') = require('os');
const { exec }: typeof import('child_process') = require('child_process');
const { promisify }: typeof import('util') = require('util');
const execAsync = promisify(exec);

export async function satisfiesPrequisites(specs: Specs): Promise<boolean> {
    // Check if group membership is required (only for Docker, not Podman)
    const requiresGroup = await ContainerRuntime.requiresGroupMembership();
    const groupCheckPassed = requiresGroup ? specs.dockerIsInUserGroups : true;

    return specs.dockerInstalled &&
        specs.dockerComposeInstalled &&
        specs.dockerIsRunning &&
        groupCheckPassed &&
        specs.freeRDP3Installed &&
        specs.ipTablesLoaded &&
        specs.iptableNatLoaded &&
        specs.kvmEnabled &&
        specs.ramGB >= 4 &&
        specs.cpuCores >= 2
}

export const defaultSpecs: Specs = { 
    cpuCores: 0,
    ramGB: 0,
    kvmEnabled: false,
    dockerInstalled: false,
    dockerComposeInstalled: false,
    dockerIsRunning: false,
    dockerIsInUserGroups: false,
    freeRDP3Installed: false,
    ipTablesLoaded: false,
    iptableNatLoaded: false
}

export async function getSpecs() {
    const specs: Specs = { ...defaultSpecs };

    // Physical CPU cores check
    try {
        const res = (await execAsync('lscpu -p | egrep -v "^#" | sort -u -t, -k 2,4 | wc -l')).stdout;
        specs.cpuCores = parseInt(res.trim(), 10);
    } catch(e) {
        console.error('Error getting CPU cores:', e);
    }

    // TODO: These commands might silently fail
    // But if they do, it means something wasn't right to begin with
    try {
        const memoryInfo = await getMemoryInfo();
        specs.ramGB = memoryInfo.totalGB;
    } catch (e) {
        console.error('Error reading /proc/meminfo:', e);
    }

    // KVM check
    try {
        const cpuInfo = fs.readFileSync('/proc/cpuinfo', 'utf8');
        if ((cpuInfo.includes('vmx') || cpuInfo.includes('svm')) && fs.existsSync('/dev/kvm')) {
            specs.kvmEnabled = true;
        }
    } catch (e) {
        console.error('Error reading /proc/cpuinfo or checking /dev/kvm:', e);
    }

    // Container runtime check (Docker or Podman)
    try {
        const runtime = await ContainerRuntime.detectRuntime();
        specs.dockerInstalled = runtime !== null;
    } catch (e) {
        console.error('Error checking for container runtime installation:', e);
    }

    // Container runtime compose plugin check with version validation
    try {
        const runtimeInfo = await ContainerRuntime.getRuntimeInfo();
        if (runtimeInfo) {
            specs.dockerComposeInstalled = runtimeInfo.composeInstalled;
        } else {
            specs.dockerComposeInstalled = false;
        }
    } catch (e) {
        console.error('Error checking container runtime compose version:', e);
    }

    // Container runtime is running check
    try {
        specs.dockerIsRunning = await ContainerRuntime.isRuntimeRunning();
    } catch (e) {
        console.error('Error checking if container runtime is running:', e);
    }

    // Container runtime user group check
    try {
        specs.dockerIsInUserGroups = await ContainerRuntime.isUserInRuntimeGroup();
    } catch (e) {
        console.error('Error checking user groups for container runtime:', e);
    }

    // FreeRDP 3.x.x check (including Flatpak)
    try {
        const freeRDPBin = await getFreeRDP();
        specs.freeRDP3Installed = !!freeRDPBin;
    } catch(e) {
        console.error('Error checking FreeRDP 3.x.x installation (most likely not installed):', e);
    }

    // iptables kernel module check
    try {
        const { stdout: ipTablesOutput } = await execAsync('lsmod | grep ip_tables');
        specs.ipTablesLoaded = !!ipTablesOutput.trim();
    } catch (e) {
        console.error('Error checking ip_tables module:', e);
    }

    // iptables_nat kernel module check
    try {
        const { stdout: iptableNatOutput } = await execAsync('lsmod | grep iptable_nat');
        specs.iptableNatLoaded = !!iptableNatOutput.trim();
    } catch (e) {
        console.error('Error checking iptable_nat module:', e);
    }

    console.log('Specs:', specs);
    return specs;
}


export type MemoryInfo = {
    totalGB: number;
    availableGB: number;
}

export async function getMemoryInfo() {
    try {
        const memoryInfo: MemoryInfo = {
            totalGB: 0,
            availableGB: 0,
        }
        const memInfo = fs.readFileSync('/proc/meminfo', 'utf8');
        const totalMemLine = memInfo.split('\n').find(line => line.startsWith('MemTotal'));
        const availableMemLine = memInfo.split('\n').find(line => line.startsWith('MemAvailable'));
        if (totalMemLine) {
            memoryInfo.totalGB = Math.round(parseInt(totalMemLine.split(/\s+/)[1]) / 1024 / 1024 * 100) / 100;
        }

        if (availableMemLine) {
            memoryInfo.availableGB = Math.round(parseInt(availableMemLine.split(/\s+/)[1]) / 1024 / 1024 * 100) / 100;
        }

        return memoryInfo;
    } catch (e) {
        console.error('Error reading /proc/meminfo:', e);
        throw e;
    }
}
