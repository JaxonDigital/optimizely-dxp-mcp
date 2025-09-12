/**
 * PowerShell Command Builder
 * Provides a fluent interface for building PowerShell commands
 * Part of Jaxon Digital Optimizely DXP MCP Server
 */

class PowerShellCommandBuilder {
    constructor(cmdlet) {
        this.cmdlet = cmdlet;
        this.params = [];
        this.switches = [];
    }

    /**
     * Add a parameter with a value
     * @param {string} name - Parameter name (without dash)
     * @param {string|number|boolean} value - Parameter value
     * @returns {PowerShellCommandBuilder} This instance for chaining
     */
    addParam(name, value) {
        if (value !== undefined && value !== null && value !== '') {
            // Handle different value types
            if (typeof value === 'boolean') {
                if (value) {
                    this.switches.push(name);
                }
            } else if (typeof value === 'string') {
                // Escape single quotes in the value
                const escapedValue = value.replace(/'/g, "''");
                this.params.push(`-${name} '${escapedValue}'`);
            } else if (typeof value === 'number') {
                this.params.push(`-${name} ${value}`);
            }
        }
        return this;
    }

    /**
     * Add a switch parameter (no value)
     * @param {string} name - Switch name (without dash)
     * @returns {PowerShellCommandBuilder} This instance for chaining
     */
    addSwitch(name) {
        this.switches.push(name);
        return this;
    }

    /**
     * Add an array parameter
     * @param {string} name - Parameter name
     * @param {Array} values - Array of values
     * @returns {PowerShellCommandBuilder} This instance for chaining
     */
    addArray(name, values) {
        if (values && Array.isArray(values) && values.length > 0) {
            const quotedValues = values.map(v => `'${v.replace(/'/g, "''")}'`).join(',');
            this.params.push(`-${name} @(${quotedValues})`);
        }
        return this;
    }

    /**
     * Add a hashtable parameter
     * @param {string} name - Parameter name
     * @param {Object} hash - Object to convert to hashtable
     * @returns {PowerShellCommandBuilder} This instance for chaining
     */
    addHashtable(name, hash) {
        if (hash && Object.keys(hash).length > 0) {
            const pairs = Object.entries(hash)
                .map(([key, value]) => `${key}='${value.replace(/'/g, "''")}'`)
                .join(';');
            this.params.push(`-${name} @{${pairs}}`);
        }
        return this;
    }

    /**
     * Add credentials (special handling for EpiCloud)
     * @param {Object} creds - Credentials object with apiKey and apiSecret
     * @returns {PowerShellCommandBuilder} This instance for chaining
     */
    addCredentials(creds) {
        if (creds.apiKey) this.addParam('ClientKey', creds.apiKey);
        if (creds.apiSecret) this.addParam('ClientSecret', creds.apiSecret);
        return this;
    }

    /**
     * Add EpiCloud standard parameters
     * @param {Object} config - Config with projectId, apiKey, apiSecret
     * @returns {PowerShellCommandBuilder} This instance for chaining
     */
    addEpiCloudParams(config) {
        if (config.projectId) this.addParam('ProjectId', config.projectId);
        if (config.apiKey) this.addParam('ClientKey', config.apiKey);
        if (config.apiSecret) this.addParam('ClientSecret', config.apiSecret);
        return this;
    }

    /**
     * Conditionally add a parameter
     * @param {boolean} condition - Whether to add the parameter
     * @param {string} name - Parameter name
     * @param {*} value - Parameter value
     * @returns {PowerShellCommandBuilder} This instance for chaining
     */
    addIf(condition, name, value) {
        if (condition) {
            this.addParam(name, value);
        }
        return this;
    }

    /**
     * Conditionally add a switch
     * @param {boolean} condition - Whether to add the switch
     * @param {string} name - Switch name
     * @returns {PowerShellCommandBuilder} This instance for chaining
     */
    addSwitchIf(condition, name) {
        if (condition) {
            this.addSwitch(name);
        }
        return this;
    }

    /**
     * Build the final command string
     * @returns {string} The complete PowerShell command
     */
    build() {
        let command = this.cmdlet;
        
        // Add all parameters
        if (this.params.length > 0) {
            command += ' ' + this.params.join(' ');
        }
        
        // Add all switches
        if (this.switches.length > 0) {
            command += ' ' + this.switches.map(s => `-${s}`).join(' ');
        }
        
        return command;
    }

    /**
     * Create a new builder instance
     * @param {string} cmdlet - The PowerShell cmdlet name
     * @returns {PowerShellCommandBuilder} New builder instance
     */
    static create(cmdlet) {
        return new PowerShellCommandBuilder(cmdlet);
    }
}

module.exports = PowerShellCommandBuilder;