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
            objectiveField: 'LeafStoryCount',
            numberOfReleases: 4,
            doneState: "GA",
            thresholdIdealLow: 80,
            thresholdIdealHigh: 100,
            thresholdOutlier: 120,
            outlierColor: "#B81B10",
            idealColor: "#b2e3b6",
            portfolioItemTypePath: 'PortfolioItem/Feature'
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
        this.updateSettingsValues({'portfolioItemTypePath': portfolioItemTypes[0]});

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
    getHighThresholdIdeal: function(){
      return this.getSetting('thresholdIdealHigh');
    },
    getLowThresholdIdeal: function(){
      return this.getSetting('thresholdIdealLow');
    },
    getOutlierThreshold: function(){
      return this.getSetting('thresholdOutlier');
    },
    getOutlierColor: function(){
      return this.getSetting('outlierColor')
    },
    getIdealColor: function(){
      return this.getSetting('idealColor')
    },
    getLowestLevelPortfolioItemType: function(){
      return this.getSetting('portfolioItemTypePath');
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
            fetch: ['ObjectID','Name','FormattedID','Project',this.getObjectiveField(),'Release','LeafStoryCount','AcceptedLeafStoryCount','State'],
            removeUnauthorizedSnapshots: true,
            hydrate: ['Project','Release','State'],
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

            yAxis: {
                title: {
                    text: 'Percent of Objectives'
                },
                plotBands: [{ // mark the weekend
                  color: this.getIdealColor(),
                  from: this.getLowThresholdIdeal(),
                  to: this.getHighThresholdIdeal()
                },{
                  color: this.getOutlierColor(),
                  from: this.getOutlierThreshold(),
                  to: this.getOutlierThreshold()+1
                }],
            }
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
                start[releaseIdx] += objective;
            }


            var releaseEndSnaps = project.snaps[idx++];
            end[releaseIdx] = 0;

            for(var i=0; i < releaseEndSnaps.length; i++){
                var snap = releaseEndSnaps[i];
                var objective = snap.get(objectiveField) || 0;
                if (this.isSnapDone(snap)){
                    end[releaseIdx] += objective;
                }
            }
            releaseIdx++;
        }, this);

        return {
            start: start,
            end: end
        };


    },
    getDoneState: function(){
      return this.getSetting('doneState');
    },
    isSnapDone: function(snap){
      this.logger.log('isSnapDone',snap.get('State'), this.getDoneState());
       return (snap.get('State') && snap.get('State') === this.getDoneState());
       //return (snap.get('LeafStoryCount') === snap.get('AcceptedLeafStoryCount'));
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
    getSettingsFields: function(){
      // objectiveField: 'LeafStoryCount',
      // numberOfReleases: 4,
      // doneState: "GA",
      // thresholdIdealLow: 80,
      // thresholdIdealHigh: 100,
      // thresholdOutlier: 120,
      // outlierColor: "#888",
      // idealColor: "#FAD200"

      return [{
         name: 'objectiveField',
         xtype: 'rallyfieldcombobox',
         model: this.getLowestLevelPortfolioItemType(),
         fieldLabel: 'Objective Field',
         labelAlign: 'right'
       },{
        name: 'doneState',
        xtype: 'rallyfieldvaluecombobox',
        fieldLabel: 'Done State',
        labelAlign: 'right',
        valueField: 'name',
        field: 'State',
        model: this.getLowestLevelPortfolioItemType()
       },{
        name: 'numberOfReleases',
        xtype: 'rallynumberfield',
        minValue: 1,
        maxValue: 8,
        fieldLabel: 'Number of Releases',
        labelAlign: 'right'
      },{
        name: 'thresholdIdealLow',
        xtype: 'rallynumberfield',
        minValue: 0,
        maxValue: 120,
        fieldLabel: 'Ideal Threshold (Low)',
        labelAlign: 'right'
      },{
        name: 'thresholdIdealHigh',
        xtype: 'rallynumberfield',
        minValue: 0,
        maxValue: 120,
        fieldLabel: 'Ideal Threshold (High)',
        labelAlign: 'right'
      },{
        name: 'thresholdOutlier',
        xtype: 'rallynumberfield',
        minValue: 80,
        maxValue: 200,
        fieldLabel: 'Outlier Threshold',
        labelAlign: 'right'
      }];

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
