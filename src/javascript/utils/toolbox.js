Ext.define('RallyTechServices.utils.Toolbox',{
    singleton: true,
    fetchPortfolioItemTypes: function(){
        var deferred = Ext.create('Deft.Deferred');

        var store = Ext.create('Rally.data.wsapi.Store', {
            model: 'TypeDefinition',
            fetch: ['TypePath', 'Ordinal','Name'],
            filters: [{
                property: 'TypePath',
                operator: 'contains',
                value: 'PortfolioItem/'
            }],
            sorters: [{
                property: 'Ordinal',
                direction: 'ASC'
            }]
        });
        store.load({
            callback: function(records, operation, success){
                if (success){
                    var portfolioItemTypes = new Array(records.length);
                    _.each(records, function(d){
                        //Use ordinal to make sure the lowest level portfolio item type is the first in the array.
                        var idx = Number(d.get('Ordinal'));
                        portfolioItemTypes[idx] = { typePath: d.get('TypePath'), name: d.get('Name') };
                        //portfolioItemTypes.reverse();
                    });
                    deferred.resolve(portfolioItemTypes);
                } else {
                    var error_msg = '';
                    if (operation && operation.error && operation.error.errors){
                        error_msg = operation.error.errors.join(',');
                    }
                    deferred.reject('Error loading Portfolio Item Types:  ' + error_msg);
                }
            }
        });
        return deferred.promise;
    },
    fetchWsapiRecords: function(config){
        var deferred = Ext.create('Deft.Deferred');

        if (!config.limit){
            config.limit = "Infinity";
        }

        var store = Ext.create('Rally.data.wsapi.Store', config);
        store.load({
            callback: function (records, operation, success) {
                if (success) {
                    deferred.resolve(records);
                } else {
                    var error_msg = '';
                    if (operation && operation.error && operation.error.errors){
                        error_msg = operation.error.errors.join(',');
                    }
                    deferred.reject('Error loading records:  ' + error_msg);
                }
            }
        });

        return deferred.promise;
    },
    fetchSnapshots: function(config){
        var deferred = Ext.create('Deft.Deferred');

        if (!config.limit){
            config.limit = "Infinity";
        }

        var store = Ext.create('Rally.data.lookback.SnapshotStore', config);
        store.load({
            callback: function (records, operation, success) {
                if (success) {
                    deferred.resolve(records);
                } else {
                    var error_msg = '';
                    if (operation && operation.error && operation.error.errors){
                        error_msg = operation.error.errors.join(',');
                    }
                    deferred.reject('Error loading snapshots:  ' + error_msg);
                }
            }
        });

        return deferred.promise;
    }
});
