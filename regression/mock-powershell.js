/**
 * Mock PowerShell Response System
 * Provides realistic PowerShell command responses for testing
 * without requiring actual PowerShell or API access
 */

class MockPowerShell {
    constructor() {
        this.responses = new Map();
        this.setupDefaultResponses();
        this.callHistory = [];
        this.errorMode = false;
        this.delay = 0;
    }

    /**
     * Execute a mock PowerShell command
     */
    async execute(command) {
        // Track call history for assertions
        this.callHistory.push({
            command,
            timestamp: Date.now()
        });

        // Simulate delay if configured
        if (this.delay > 0) {
            await new Promise(resolve => setTimeout(resolve, this.delay));
        }

        // Check for error mode
        if (this.errorMode) {
            throw new Error('Mock PowerShell error: Command failed');
        }

        // Parse command to determine response
        const response = this.getResponse(command);
        
        if (response.error) {
            throw new Error(response.error);
        }

        return response.output;
    }

    /**
     * Get response based on command pattern
     */
    getResponse(command) {
        // Check for exact matches first
        if (this.responses.has(command)) {
            return this.responses.get(command);
        }

        // Pattern matching for dynamic commands
        for (const [pattern, response] of this.responses.entries()) {
            if (pattern instanceof RegExp && pattern.test(command)) {
                return typeof response === 'function' ? response(command) : response;
            }
        }

        // Default response for unknown commands
        return {
            output: '',
            error: `Unknown command: ${command}`
        };
    }

    /**
     * Setup default responses for common commands
     */
    setupDefaultResponses() {
        // Test connection
        this.responses.set(/Get-EpiStorageContainer.*ErrorAction Stop/, {
            output: JSON.stringify([{
                StorageContainer: 'mysitemedia',
                EnvironmentName: 'Production',
                HasReadAccess: true
            }])
        });

        // List deployments
        this.responses.set(/Get-EpiDeployment.*Select-Object -First/, {
            output: JSON.stringify([{
                Id: 'mock-deployment-001',
                Status: 'Succeeded',
                SourceEnvironment: 'Integration',
                TargetEnvironment: 'Preproduction',
                StartTime: new Date().toISOString(),
                EndTime: new Date().toISOString(),
                DeploymentType: 'Code'
            }])
        });

        // Get deployment by ID
        this.responses.set(/Get-EpiDeployment -Id/, (command) => {
            const idMatch = command.match(/-Id\s+'([^']+)'/);
            const id = idMatch ? idMatch[1] : 'unknown';
            
            return {
                output: JSON.stringify({
                    Id: id,
                    Status: 'InProgress',
                    SourceEnvironment: 'Integration', 
                    TargetEnvironment: 'Preproduction',
                    StartTime: new Date().toISOString(),
                    PercentComplete: 45
                })
            };
        });

        // Start deployment
        this.responses.set(/Start-EpiDeployment/, {
            output: JSON.stringify({
                Id: 'new-deployment-' + Date.now(),
                Status: 'InProgress',
                SourceEnvironment: 'Integration',
                TargetEnvironment: 'Preproduction'
            })
        });

        // Export database
        this.responses.set(/Start-EpiDatabaseExport/, {
            output: JSON.stringify({
                Id: 'export-' + Date.now(),
                Status: 'InProgress',
                Environment: 'Production',
                DatabaseName: 'epicms',
                DownloadLink: null,
                ExpiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
            })
        });

        // Get database export
        this.responses.set(/Get-EpiDatabaseExport.*-Id/, (command) => {
            const idMatch = command.match(/-Id\s+'([^']+)'/);
            const id = idMatch ? idMatch[1] : 'unknown';
            
            return {
                output: JSON.stringify({
                    Id: id,
                    Status: 'Succeeded',
                    Environment: 'Production',
                    DatabaseName: 'epicms',
                    DownloadLink: `https://mock.download.url/${id}.bacpac`,
                    FileSize: 1024 * 1024 * 500, // 500MB
                    ExpiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
                })
            };
        });

        // List database exports
        this.responses.set(/Get-EpiDatabaseExport(?!\s+-Id)/, {
            output: JSON.stringify([
                {
                    Id: 'export-recent-001',
                    Status: 'Succeeded',
                    Environment: 'Production',
                    DatabaseName: 'epicms',
                    CreatedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
                    DownloadLink: 'https://mock.download.url/recent.bacpac'
                },
                {
                    Id: 'export-old-001',
                    Status: 'Succeeded',
                    Environment: 'Production',
                    DatabaseName: 'epicms',
                    CreatedAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
                    DownloadLink: 'https://mock.download.url/old.bacpac'
                }
            ])
        });

        // Complete deployment
        this.responses.set(/Complete-EpiDeployment/, {
            output: JSON.stringify({
                Status: 'Succeeded',
                Message: 'Deployment completed successfully'
            })
        });

        // Reset deployment
        this.responses.set(/Reset-EpiDeployment/, {
            output: JSON.stringify({
                Status: 'Reset',
                Message: 'Deployment has been reset'
            })
        });

        // Get project info
        this.responses.set(/Get-EpiCloudProject/, {
            output: JSON.stringify({
                ProjectId: 'mock-project-id',
                ProjectName: 'Mock Test Project',
                OrganizationName: 'Mock Organization'
            })
        });

        // Storage container SAS
        this.responses.set(/Get-EpiStorageContainerSasLink/, {
            output: JSON.stringify({
                SasUrl: 'https://mock.blob.core.windows.net/container?sv=2021-08-06&sig=mock',
                ExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
            })
        });
    }

    /**
     * Add custom response for specific command or pattern
     */
    addResponse(pattern, response) {
        this.responses.set(pattern, response);
    }

    /**
     * Clear call history
     */
    clearHistory() {
        this.callHistory = [];
    }

    /**
     * Get call history
     */
    getHistory() {
        return this.callHistory;
    }

    /**
     * Get call count for pattern
     */
    getCallCount(pattern) {
        if (typeof pattern === 'string') {
            return this.callHistory.filter(h => h.command === pattern).length;
        }
        if (pattern instanceof RegExp) {
            return this.callHistory.filter(h => pattern.test(h.command)).length;
        }
        return 0;
    }

    /**
     * Assert command was called
     */
    assertCalled(pattern, times = 1) {
        const count = this.getCallCount(pattern);
        if (count !== times) {
            throw new Error(`Expected ${pattern} to be called ${times} times, but was called ${count} times`);
        }
    }

    /**
     * Set error mode
     */
    setErrorMode(enabled) {
        this.errorMode = enabled;
    }

    /**
     * Set response delay in ms
     */
    setDelay(ms) {
        this.delay = ms;
    }

    /**
     * Reset to default state
     */
    reset() {
        this.responses.clear();
        this.setupDefaultResponses();
        this.clearHistory();
        this.errorMode = false;
        this.delay = 0;
    }
}

module.exports = MockPowerShell;