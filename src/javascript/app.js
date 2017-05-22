Ext.define("release-predictability", {
    extend: 'Rally.app.App',
    componentCls: 'app',
    logger: new Rally.technicalservices.Logger(),
    defaults: { margin: 10 },
    items: [
        {xtype:'container',itemId:'message_box',tpl:'Hello, <tpl>{_refObjectName}</tpl>'},
        {xtype:'container',itemId:'display_box'}
    ],

    integrationHeaders : {
        name : "release-predictability"
    },

    config: {
        defaultSettings: {
            objectiveField: 'RefinedEstimate',
            numberOfReleases: 4
        }
    },
                        
    launch: function() {
        RallyTechServices.utils.Toolbox.fetchPortfolioItemTypes().then({
            success: this.initializeApp,
            failure: this.showErrorNotification,
            scope: this
        });
    },
    initializeApp: function(portfolioItemTypes){
        this.logger.log('initializeApp', portfolioItemTypes);
        this.portfolioItemTypes = portfolioItemTypes;

        this.fetchReleaseInfo()
            .then({
                success: this.fetchReleases,
                failure: this.showErrorNotification,
                scope: this
            })
            .then({
                success: this.fetchSnapshots,
                failure: this.showErrorNotification,
                scope: this
            })
            .then({
                success: this.buildChart,
                failure: this.showErrorNotification,
                scope: this
            });

    },
    getNumberOfReleases: function(){
        return this.getSetting('numberOfReleases');
    },
    fetchReleaseInfo: function(){
        this.logger.log('fetchReleaseInfo');

        return RallyTechServices.utils.Toolbox.fetchWsapiRecords({
            model: 'Release',
            fetch: ['Name','ReleaseStartDate','ReleaseDate'],
            filters: [{
                property: 'ReleaseDate',
                operator: "<",
                value: Rally.util.DateTime.toIsoString(new Date())
            }],
            context: {
                projectScopeDown: false,
                projectScopeUp: false,
                project: this.getContext().getProject()._ref
            },
            sorters: [{
                property: 'ReleaseDate',
                direction: 'Desc'
            }],
            limit: this.getNumberOfReleases(),
            pageSize: this.getNumberOfReleases()
        });
    },
    fetchReleases: function(projectReleases){
        this.logger.log('fetchReleases', projectReleases);
        var filters = Ext.Array.map(projectReleases, function(r){ return {
                property: 'Name',
                value: r.get('Name')
            };
        });
        filters = Rally.data.wsapi.Filter.or(filters);

        return RallyTechServices.utils.Toolbox.fetchWsapiRecords({
            model: 'Release',
            fetch: ['Name','ReleaseStartDate','ReleaseDate','ObjectID'],
            filters: filters,
            sorters: [{
                property: 'ReleaseDate',
                direction: 'ASC'
            }]
        });

    },
    fetchSnapshots: function(releases){
        this.logger.log('fetchSnapshots', releases);
        var releaseHash = {};
        Ext.Array.each(releases, function(r){
            var name = r.get('Name');
            if (!releaseHash[name]){
                releaseHash[name] = {
                    releaseStartDate: Rally.util.DateTime.toIsoString(r.get('ReleaseStartDate')),
                    releaseDate: Rally.util.DateTime.toIsoString(r.get('ReleaseDate')),
                    name: r.get('Name'),
                    oids: []
                }
            }
            releaseHash[name].oids.push(r.get('ObjectID'));
        });
        this.releaseHash = releaseHash;


        var promises = [],
            featureTypePath = this.getFeatureTypePath(),
            projectID = this.getContext().getProject().ObjectID,
            config = {
            find: {
                _TypeHierarchy: featureTypePath,
                _ProjectHierarchy: projectID,
                //  Release: {$in: releases},
                //  __At: releaseStartDate
            },
            fetch: ['ObjectID','Name','FormattedID','Project',this.getObjectiveField(),'Release','LeafStoryCount','AcceptedLeafStoryCount'],
            removeUnauthorizedSnapshots: true,
            hydrate: ['Project','Release'],
            limit: 'Infinity'
        };


        Ext.Object.each(releaseHash, function(key, obj){
            var cfg = Ext.clone(config);
            cfg.find.Release = {$in: obj.oids};
            cfg.find.__At = obj.releaseStartDate;
            promises.push(RallyTechServices.utils.Toolbox.fetchSnapshots(cfg));

            var cfg = Ext.clone(config);
            cfg.find.Release = {$in: obj.oids};
            cfg.find.__At =  obj.releaseDate;
            promises.push(RallyTechServices.utils.Toolbox.fetchSnapshots(cfg));

        });

        return Deft.Promise.all(promises);

    },
    getFeatureTypePath: function(){
        return this.portfolioItemTypes[0].typePath;
    },
    getObjectiveField: function(){
        return this.getSetting('objectiveField');
    },
    buildChart: function(snapshots){
        this.logger.log('buildChart', snapshots);

        var projectHash = this.getProjectHash(snapshots);

        var idx = 0,
            series = [];

        var totalStart= [],
            totalEnd = [];

        Ext.Object.each(projectHash, function(key, obj){
            var startAndEnd = this.getDataPoint(obj, this.releaseHash);
            var data = [];
            for (var i=0; i<startAndEnd.start.length; i++){
                var point = startAndEnd.start[i] ? startAndEnd.end[i]/startAndEnd.start[i] * 100 : 0;
                totalStart[i] = (totalStart[i] || 0) + startAndEnd.start[i];
                totalEnd[i] = (totalEnd[i] || 0) + startAndEnd.end[i];
                data.push(Math.round(point));
            }
            series.push({
                name: obj.Name,
                data: data
            });
        }, this);

        var totalData = [];
        for (var i=0; i<totalStart.length; i++){
            var point = totalStart[i] ? totalEnd[i]/totalStart[i] * 100 : 0;
            totalData.push(Math.round(point));
        }

        series.push({
            name: 'Total',
            data: totalData
        });


        var categories = Ext.Object.getKeys(this.releaseHash);
        this.logger.log('chartData', categories, series);
        this.add({
            xtype: 'rallychart',
            chartConfig: this.getChartConfig(),
            chartData: {
                series: series,
                categories: categories
            }
        });
    },
    getChartConfig: function(){
        return {
            chart: {
                type: 'line'
            },
            title: {
                text: 'Release Predictability'
            },

            //subtitle: {
            //    text: 'Source: thesolarfoundation.com'
            //},

            yAxis: {
                title: {
                    text: 'Percent of Objectives'
                }
            }
            //legend: {
            //    layout: 'vertical',
            //    align: 'right',
            //    verticalAlign: 'middle'
            //},

            //plotOptions: {
            //    series: {
            //        pointStart: 2010
            //    }
            //}
        };
    },
    getDataPoint: function(project, releaseHash){
        var objectiveField = this.getObjectiveField();

        var idx = 0,
            releaseIdx = 0;
        var start = [],
            end = [];

        Ext.Object.each(releaseHash, function(key, obj){
            var releaseStartSnaps = project.snaps[idx++];
            start[releaseIdx] = 0;
            for(var i=0; i < releaseStartSnaps.length; i++){
                var objective = releaseStartSnaps[i].get(objectiveField) || 0;
                console.log('start snap', objective);
                start[releaseIdx] += objective;
            }


            var releaseEndSnaps = project.snaps[idx++];
            end[releaseIdx] = 0;

            for(var i=0; i < releaseEndSnaps.length; i++){
                var snap = releaseEndSnaps[i];
                var objective = snap.get(objectiveField) || 0;
                console.log('end snap', objective);
                if (snap.get('LeafStoryCount') === snap.get('AcceptedLeafStoryCount')){
                    end[releaseIdx] += objective;
                }
            }
            releaseIdx++;
        });

        return {
            start: start,
            end: end
        };


    },
    getProjectHash: function(snapshots){
        var projectHash  = {};
        for (var i=0; i < snapshots.length; i++){
            var snaps = snapshots[i];
            for (var j=0; j<snaps.length; j++){
                var project = snaps[j].get('Project'),
                    release = snaps[j].get('Release');
                if (!projectHash[project.ObjectID]){
                    var initSnaps = Ext.Array.map(snapshots, function(snaps){ return []; });
                    projectHash[project.ObjectID] = {
                        Name: project.Name,
                        snaps: initSnaps
                    }
                }
                projectHash[project.ObjectID].snaps[i].push(snaps[j]);
            }
        }
        return projectHash;
    },

    showErrorNotification: function(msg){
        Rally.ui.notify.Notifier.showError(msg);
    },
    getOptions: function() {
        return [
            {
                text: 'About...',
                handler: this._launchInfo,
                scope: this
            }
        ];
    },
    
    _launchInfo: function() {
        if ( this.about_dialog ) { this.about_dialog.destroy(); }
        this.about_dialog = Ext.create('Rally.technicalservices.InfoLink',{});
    },
    
    isExternal: function(){
        return typeof(this.getAppId()) == 'undefined';
    }
    
});
