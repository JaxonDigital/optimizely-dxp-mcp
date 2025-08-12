# Optimizely DXP Testing Checklist

**Project ID:** `caecbb62-0fd4-4d09-8627-ae7e018b595e`

## 🚀 Deployment Management

### Basic Deployment Operations
- [x] **List All Deployments** - ✅ Working! Shows 10 recent deployments, mostly successful
- [x] **Get Deployment Status** - ✅ Working! Detailed info: Production→Preproduction, 12min duration
- [ ] **Start Deployment** - Deploy between environments (Int→Pre, Pre→Prod, etc.)
- [ ] **Complete Deployment** - Finalize deployments in verification state  
- [ ] **Reset/Rollback Deployment** - Undo problematic deployments

### Package Deployment
- [ ] **Upload Deployment Package** - Upload .nupkg to environment
- [ ] **Deploy Package and Start** - Combined upload + deploy operation

## 💾 Database Operations

### Database Export
- [ ] **Export EpiCMS Database** - Export from Integration environment
- [ ] **Export EpiCMS Database** - Export from Preproduction environment
- [ ] **Export EpiCMS Database** - Export from Production environment
- [x] **Export EpiCommerce Database** - ❌ N/A - No Commerce in this project
- [x] **Export EpiCommerce Database** - ❌ N/A - No Commerce in this project  
- [x] **Export EpiCommerce Database** - ❌ N/A - No Commerce in this project

### Export Status Monitoring
- [ ] **Check Export Status** - Monitor database export progress

## 🗂️ Storage Management

### Container Operations
- [x] **List Storage Containers** - Integration environment - ✅ Working! 4 containers found
- [x] **List Storage Containers** - Preproduction environment - ✅ Working! 4 containers found  
- [x] **List Storage Containers** - Production environment - ✅ Working! 4 containers found

### SAS Link Generation
- [x] **Generate Read SAS Link** - For Integration container - ✅ Working! Generated 24hr read access URL
- [x] **Generate Write SAS Link** - For Integration container - ✅ Working! Generated 1hr write access URL
- [ ] **Generate Delete SAS Link** - For Integration container
- [ ] **Generate List SAS Link** - For Integration container

## 📋 Content Management

### Content Copy Operations
- [ ] **Copy Content** - Integration → Preproduction
- [ ] **Copy Content** - Preproduction → Production
- [x] **Copy Content** - Production → Integration - ✅ Working! Completed successfully in 13 minutes
- [x] **Upload Deployment Package** - ❌ Failed: File system access restrictions
- [x] **Deploy Package and Start** - ❌ Failed: File system access restrictions (rollback scenario)

## 📊 Monitoring & Logs

### Log Retrieval
- [x] **Get Edge Logs** - Integration environment (1 hour) - ❌ Failed: Invalid Operation State
- [x] **Get Edge Logs** - Preproduction environment (1 hour) - ❌ Failed: Invalid Operation State  
- [x] **Get Edge Logs** - Production environment (1 hour) - ❌ Failed: Invalid Operation State
- [ ] **Get Edge Logs** - Extended timeframe (24 hours)

## 🔧 Server Information
- [x] **Get Server Info** - ✅ Already tested - Server configured correctly

---

## Testing Strategy

**Phase 1: Read-Only Operations** (Safe to test)
- Server info, list deployments, list containers, get logs
- Database export status checks
- Deployment status checks

**Phase 2: Low-Risk Operations** (Minimal impact)
- Database exports
- SAS link generation
- Storage container listings

**Phase 3: High-Impact Operations** (Use with caution)
- Starting deployments
- Content copying
- Package uploads
- Deployment completions/rollbacks

## Notes
- All operations use the configured credentials automatically
- Each environment (Integration/Preproduction/Production) will be tested
- Start with read-only operations to verify connectivity
- Document any errors or unexpected behaviors
- Some operations may take time to complete (exports, deployments)