const request = require('request');
const config = require('./config.json');
const MongoClient = require('mongodb').MongoClient;
const qs = require('querystring');
const striptags = require('striptags');
const urlEncode = require('urlencode');
const nodeAxosoft = require('./nodeAxosoft.js');
const entities = require("entities");

module.exports = {
makeRequest: function(method, URL, params, callback){
                request({
                    url: URL,
                    qs: params,
                    method: method || "GET"
                  }, callback);
},

sendTextToSlack: function(slackToken, channelId, txt){
                    var params = {
                      token: slackToken,
                      channel: channelId,
                      text: txt
                    };
                    module.exports.makeRequest("POST", `https://slack.com/api/chat.postMessage`, params, function(error, response, body){
                      console.log(error);
                    });
},

formatText: function(body, message){
                var pageTotal = Math.ceil((body.metadata.total_count/body.metadata.page_size));
                var page = body.metadata.page === 0 ? 1 : body.metadata.page;
                var txt = "Here are ";
                if(message.text.includes("my ")){
                   txt = txt + "your ";
                   addWhiteSpace = false;
                }
                if (message.match[2].length > 0) {
                  txt += message.match[2];
                }

                if(message.text.match('(.*)(page)(\\s)(\\d+)(.*)') != null){
                  if(message.text.includes("closed")){
                    return `${txt}items [in the last 30 days] (page ${page} of ${pageTotal})`
                  }else{
                    return `${txt}items (page ${page} of ${pageTotal})`;
                  }
                }else{
                  if(message.text.includes("closed")){
                    return (pageTotal>1) ? txt = txt + `items [in the last 30 days], (page 1 of ${pageTotal})` : txt = txt + "items [in the last 30 days]";
                  }else if(pageTotal>1){
                    return `${txt}items (page 1 of ${pageTotal})`;
                  }else{
                    return `${txt}items`;
                  }
                }
},

sendDataToSlack: function(slackAccessToken, message, body, axoBaseUrl, axosoftToken){
                    var myKeyWordTypedByUser = false;
                    if(message.match[1].includes("my")){
                      myKeyWordTypedByUser = true;
                    };

                    module.exports.attachmentMaker(body, axoBaseUrl, axosoftToken, myKeyWordTypedByUser)
                    .then(function(attach){
                          var params = {
                                token: slackAccessToken,
                                channel: message.channel,
                                mrkdwn: true,
                                text: module.exports.formatText(body, message),
                                attachments: JSON.stringify(attach) 
                          };
                          module.exports.makeRequest("GET","https://slack.com/api/chat.postMessage", params, function(err, response, body){});
                    }).catch(function(reason){
                        console.log(reason);
                    });
},

sendEventToGoogleAnalytics: function(accountName, action, label) {
                  var googleAnalyticsKey = config.googleAnalyticsKey;
                  var URL = 'https://www.google-analytics.com/collect';
                  var params = {
                    v: '1',
                    tid: googleAnalyticsKey,
                    t: 'event',
                    ec: accountName,
                    ea: action,
                    el: label,
                    cid: '555'
                  };

                  module.exports.makeRequest('POST', URL, params, function(err, response, body){});
},

attachmentMaker: function (Body, axoBaseUrl, axosoftToken, myKeyWordExists){
                    return new Promise(function(resolve, reject){
                          var attachmentArrays = [];
                          var parentIds = [];
                          var axosoftData;
                          var indexOfitemsWithParent = [];
                          const itemsWithParent = [];

                          var formatDueDate = function(data){
                                  if((data.percent_complete != "100") && (data.due_date != null)){
                                    return '\`Due: ' + module.exports.timeFormat(data.due_date) + '\`';
                                  }else{
                                    return "";
                                  }
                          };

                          var formatCompletionDate = function(data){
                                  if(data != null){
                                    return '\`Closed: ' + module.exports.timeFormat(data) + '\`';
                                  }else{
                                    return "";
                                  }
                          };

                          for (x = 0; x < Body.data.length; x++) {
                                var axosoftData = module.exports.axosoftDataBuilder(axoBaseUrl, Body.data[x]);
                                if(myKeyWordExists)axosoftData.assigned_to = "";

                                if (axosoftData.parent.id > 0) {
                                  if((parentIds.indexOf(Body.data[x].parent.id) == -1)){
                                      parentIds.push(Body.data[x].parent.id);
                                  }
                                  indexOfitemsWithParent.push(x);
                                  itemsWithParent.push(Body.data[x]);
                                }else{
                                  var custom_1 = (axosoftData.custom_fields && axosoftData.custom_fields.custom_1) || '';
                                  if(Body.data[x].hasOwnProperty("completion_date")){
                                      axosoftData.completionDate = Body.data[x].completion_date;
                                      attachmentArrays.push({
                                        color: "#38B040",
                                        text: `<${axosoftData.link}| ${axosoftData.number}>: ${custom_1}  *${axosoftData.name}*  ${axosoftData.assigned_to}  \`${axosoftData.workflow_step}\` ${formatCompletionDate(axosoftData.completionDate)}`,
                                        mrkdwn_in:["text"]
                                      });
                                  }else{
                                      attachmentArrays.push({
                                        color: "#38B040",
                                        text: `<${axosoftData.link}| ${axosoftData.number}>: ${custom_1}  *${axosoftData.name}*  ${axosoftData.assigned_to}  \`${axosoftData.workflow_step}\` ${formatDueDate(Body.data[x])}`,
                                        mrkdwn_in:["text"]
                                      });
                                  }
                                }
                        }

                        module.exports.getParentName(parentIds, axoBaseUrl, axosoftToken)
                        .then(function(parentDictionary){
                            for(e=0; e < itemsWithParent.length; e++){
                              var item = itemsWithParent[e];
                              item.parent_name = parentDictionary[item.parent.id];
                              item.parent_link = `${axoBaseUrl}/viewitem?id=${item.parent.id}&type=${item.item_type}&force_use_number=true/`;
                              var data = module.exports.axosoftDataBuilder(axoBaseUrl, item);
                              if(myKeyWordExists)data.assigned_to = "";

                              var custom_1 = (data.custom_fields && data.custom_fields.custom_1) || '';
                              if(item.hasOwnProperty("completion_date")){
                                  data.completionDate = item.completion_date;
                                  attachmentArrays.splice(indexOfitemsWithParent[e],0,{
                                      color: "#38B040",
                                      text: `<${data.link}| ${data.number}>: ${custom_1}  *${data.name}*  ${data.assigned_to}  \`${data.workflow_step}\` ${formatCompletionDate(data.completionDate)}\n\t(Parent) <${data.parent_link}|${data.parent.id}>: ${data.parent_name}`,
                                      mrkdwn_in:["text"]
                                  });
                              }else{
                                  attachmentArrays.splice(indexOfitemsWithParent[e],0,{
                                    color: "#38B040",
                                    text: `<${data.link}| ${data.number}>: ${custom_1}  *${data.name}*  ${data.assigned_to}  \`${data.workflow_step}\` ${formatDueDate(item)}\n\t(Parent) <${data.parent_link}|${data.parent.id}>: ${data.parent_name}`,
                                    mrkdwn_in:["text"]
                                  });
                              }
                            }
                            resolve(attachmentArrays);
                        })
                        .catch(function(reason){
                          console.log(reason);
                        })
                    });
},

attachmentMakerForHelpOptions: function(){
                                  return new Promise(function(resolve, reject){
                                      var options = [
                                        "*axo + ID:* Shows details of a single item, e.g. axo 5 (works in any room the Axosoft bot is in)",

                                        "*get my items:* List of items currently assigned to you"
                                        + "\n*get my updated items:* List of your most recently updated items"
                                        + "\n*get my upcoming items:* List of your open items due in the next 2 weeks"
                                        + "\n*get my closed items:* List of your items closed in the last 30 days"
                                        + "\n*get my open items:* List of your items not yet completed"
                                        + "\n*get my ranked items:* List of your items sorted by rank",

                                        "*get updated items:* List of all most recently updated items"
                                        + "\n*get upcoming items:* List of all open items due in the next 2 weeks"
                                        + "\n*get closed items:* List of all items closed in the last 30 days"
                                        + "\n*get open items:* List of all items not yet completed"
                                        + "\n*get ranked items:* List of all items sorted by rank",

                                        "Add 'page #' after any command to view items on that page, e.g. `get my upcoming items page 2`",
                                        
                                        "*update url:* Updates URL to your Axosoft account",

                                        'For any questions or feedback, contact <https://support.axosoft.com/|success@axosoft.com>'
                                      ];

                                      var helpOpptionsArray = [];
                                      for(x=0; x<options.length; x++){
                                        helpOpptionsArray.push({
                                          color: "#38B040",
                                          text: options[x],
                                          mrkdwn_in:["text"]
                                        });
                                      }
                                      resolve(helpOpptionsArray);
                                  });
},

getParentName: function(parentIds, axoBaseUrl, axosoftToken){
                  var parentDictionary = {}; 
                  return new Promise(function(resolve, reject){
                      if(parentIds.length > 0){
                           var args = [{
                              access_token: axosoftToken,
                              filters: `id=in[${parentIds}]`,
                              columns: "name",
                            }];
                            var nodeAxo = new nodeAxosoft(axoBaseUrl, args[0].access_token);
                            nodeAxo.promisify(nodeAxo.axosoftApi.Features.get, args)
                            .then(function(response){
                              if(response.data.length != 0){
                                  for(x=0; x<response.data.length; x++){
                                    parentDictionary[response.data[x].id] = response.data[x].name;
                                  }
                                  resolve(parentDictionary);
                              }else{
                                console.log("helper.getParentName data.length == 0");
                              }
                            })
                            .catch(function(reason){
                              console.log(reason);
                              reject(reason);
                            });
                      }else{
                        resolve(parentDictionary);
                      } 
                  });
},

timeFormat: function(input){
                var parts = input.match(/(\d+)/g);
                date = new Date(parts[0], parts[1]-1, parts[2]); 

                var months = ["Jan", "Feb", "Mar", "Apr", "May", "June", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
                var strDate = "";
                var day = date.getDate();
                var month = months[date.getMonth()];
                
                var today = new Date();
                today.setHours(0, 0, 0, 0);
                
                var yesterday = new Date();
                yesterday.setHours(0, 0, 0, 0);
                yesterday.setDate(yesterday.getDate() - 1);
                
                var tomorrow = new Date();
                tomorrow.setHours(0, 0, 0, 0);
                tomorrow.setDate(tomorrow.getDate() + 1);
                
                console.log(date.getTime()==today.getTime());
                
                if(today.getTime() == date.getTime()){
                    strDate = "Today";
                }else if(yesterday.getTime() == date.getTime()){
                    strDate = "Yesterday";
                }else if(tomorrow.getTime() == date.getTime()){
                    strDate = "Tomorrow";
                }else{
                    strDate = months[date.getMonth()] + " " +  date.getDate();
                }
                return strDate;
},

getUserIdAxosoft: function(axoBaseUrl, axoAccessToken){
                      return new Promise(function(resolve, reject){
                      var args = [{
                        access_token: axoAccessToken
                      }];
                      var nodeAxo = new nodeAxosoft(axoBaseUrl, args[0].access_token);
                      nodeAxo.promisify(nodeAxo.axosoftApi.Me.get)
                      .then(function(response){
                        resolve(response.data.id);
                      }).catch(function(reason){
                        reject(reason);
                      });
                      });
},

saveAxosoftAccessToken: function(userId, teamId, accessToken){
                          MongoClient.connect(config.mongoUri, function(err, database){
                              if(err) return console.log(err);
                              database.collection('users').findAndModify(
                              {id: userId, team_id: teamId}, 
                              [],
                              {$set: {axosoftAccessToken: accessToken}}, 
                              {},
                              function(err, object) {
                                  if (err){
                                      console.warn(err.message); 
                                  }else{
                                      console.dir(object);
                                  }
                              });
                          });
},

saveAxosoftUrl: function(data, baseUrl) {
                    MongoClient.connect(config.mongoUri, function(err, database){
                        if(err) return console.log(err);
                        database.collection('teams').findAndModify(
                          {id: data.team}, 
                          [],
                          {$set: {axosoftBaseURL: baseUrl}}, 
                          {},
                          function(err, object) {
                              if (err){
                                  console.warn(err.message); 
                              }else{
                                  console.dir(object);
                              }
                        });
                    });
},

checkAxosoftDataForUser: function(bot, message) {
                            var userData = {};
                            return new Promise(function(resolve, reject) {
                              MongoClient.connect(config.mongoUri, function(err, database){
                                module.exports.getAxosoftBaseUrl(bot, message, database)
                                .then(function(axosoftBaseURL){
                                  userData.axosoftBaseURL = axosoftBaseURL;
                                  var axosoftAccessToken = module.exports.getAxosoftAccessToken(bot, message, database, axosoftBaseURL)
                                  return axosoftAccessToken})
                                .then(function(axosoftAccessToken){
                                  userData.axosoftAccessToken = axosoftAccessToken;
                                  if(axosoftAccessToken){
                                    resolve(userData);
                                  }
                                    reject('no axosoft access token');
                                  })
                                  .catch(function(reason){
                                    console.log(reason);
                                  });
                                });
                              });
},

getAxosoftBaseUrl: function(bot, message, database) {
                      return new Promise(function(resolve, reject){
                          database.collection('teams').find({"id":message.team}).toArray(function(err, results){
                              if (!err && results.length > 0) {
                                  if (results[0].axosoftBaseURL == undefined) {
                                    resolve(module.exports.setAxosoftBaseUrl(bot, message));
                                  }else{
                                    resolve(results[0].axosoftBaseURL);
                                  }
                              }else{
                                console.log(err);
                                reject('Couldn\'t find URL.')
                              }
                          });
                      }); 
},

getAxosoftAccessToken: function(bot, message, database, axosoftBaseURL) {
                          return new Promise(function(resolve, reject){
                            database.collection('users').find({"id":message.user}).toArray(function(err, results){
                                if(!err & results.length > 0){
                                    if(results[0].axosoftAccessToken == undefined){
                                      module.exports.setAxosoftAccessToken(bot, message, axosoftBaseURL);
                                    }else{
                                      resolve(results[0].axosoftAccessToken);
                                    }
                                }else{
                                  module.exports.createNewUser(message)
                                  .then(function(){
                                    module.exports.setAxosoftAccessToken(bot, message, axosoftBaseURL);
                                  })
                                  reject('No user');
                                }
                              })
                          });
},

retrieveDataFromDataBase: function(slackTeamId, slackUserId, documentName){
                              return new Promise(function(resolve, reject){
                                  var axosoftAccessToken, axosoftBaseURL, slackAccessToken, axosoftUserId;

                                  MongoClient.connect(config.mongoUri, function(err, database){
                                    if(err) {
                                      return console.log(err);
                                    };

                                    if(documentName === "users"){
                                        database.collection('users').find({"team_id":slackTeamId, "id": slackUserId }).toArray(function(err, results){
                                            if(err) return console.log(err);
                                              if(results[0] === undefined){
                                                console.log("There is no document with the specified slack user id in our database!");
                                                reject({axosoftAccessToken : null});
                                              }else{
                                                    if(results[0].axosoftAccessToken === undefined){
                                                      console.log("There is no userIdAxosoft within the found document!");
                                                      resolve({axosoftAccessToken: "-1"});
                                                    }else{
                                                        resolve({axosoftAccessToken: results[0].axosoftAccessToken});
                                                    }
                                              }
                                        });
                                    }else if(documentName === "teams"){
                                        database.collection('teams').find({"id":slackTeamId}).toArray(function(err, results){
                                            if(err){
                                              console.log(err);
                                              reject("Not able to connect to the database");
                                            }
                                            else{
                                                if(results[0] === undefined){
                                                    console.log("There is no team with the speciftied id in our database!");
                                                    reject("There is no team with the speciftied id in our database!");
                                                }else{
                                                      resolve({
                                                          axosoftBaseURL: results[0].axosoftBaseURL,
                                                          slackAccessToken: results[0].token
                                                      });
                                                }
                                            }
                                       });
                                    }
                                    database.close();
                                  }); 
                              });
},

createNewUser: function(message){
                        return new Promise(function(resolve, reject){
                              MongoClient.connect(config.mongoUri, function(err, database){
                                  if(err) return console.log(err);
                                  database.collection('users').insertOne({
                                    team_id: message.team, 
                                    id: message.user
                                  });
                                  database.close();
                                  resolve("");
                              });
                        });
},

formatAxosoftBaseUrl: function(url){
                        if(url.indexOf("https://") == -1 && url.indexOf("http://") == -1){
                          return url = "https://"+url;
                        }
                        // breaks if using http for hosted accnts 
                        else if (url.indexOf("http://") > -1 && url.indexOf(".axosoft.com") > -1){
                          return url.replace("http://", "https://")
                        } else {
                          return url;
                        }
},

axosoftLoginUrlBuilder: function(axosoftUrl, message){
                            var axosoftLoginUrl = axosoftUrl 
                            + '/auth?response_type=code'
                            + '&client_id='+ config.axosoftClientId
                            + '&redirect_uri=' + config.baseUri + "/authorizationCode"
                            + '&scope=read write'
                            + '&expiring=false'
                            + "&state="+ urlEncode(`userId=${message.user}&teamId=${message.team}&channelId=${message.channel}`);

                            return axosoftLoginUrl;
},

setAxosoftAccessToken:function(bot, message, axosoftUrl){
                          var axosoftLoginUrl = module.exports.axosoftLoginUrlBuilder(axosoftUrl, message);
                          bot.reply(message, `I need permissions to talk to your Axosoft account. <${axosoftLoginUrl}|Click here to Authorize>`);
},

setAxosoftBaseUrl: function(bot, message){
  return new Promise(function(resolve, reject) {
bot.startConversation(message, function(err, convo) {
        convo.ask("Can you tell me the URL of your Axosoft account? i.e. https://example.axosoft.com", function(response, convo) {
        var baseUrl = module.exports.formatAxosoftBaseUrl(response.text.replace(/[<>]/g, ''));
        module.exports.makeRequest('GET', baseUrl + '/api/version', {}, function(error, response, body){
          if(!error && response.statusCode == 200){
            var Body = JSON.parse(body);
            if(Body.data.hasOwnProperty("revision") && Body.data.revision >= 11218){
              var axosoftLoginUrl = module.exports.axosoftLoginUrlBuilder(baseUrl, message);
                module.exports.saveAxosoftUrl(message, baseUrl);
                resolve(baseUrl);
                convo.say("Got it :ok_hand:");
                convo.next();
            } else {
              convo.say("I can only talk to Axosoft v17 or later.  Please upgrade your Axosoft version.");
              convo.next();
            }
          }else{
            convo.say("This doesn't seem to be an Axosoft URL");
            convo.next();
          }
        });
        });
    });
  });
},

authorizeUserwithoutCollection:function(bot, message, returnedData){
                                  var saveAxoBaseUrl = false;
                                  module.exports.retrieveDataFromDataBase(message.team, message.user,"teams")
                                  .then(function(returnedData){
                                      if(returnedData.axosoftBaseURL == undefined){
                                        saveAxoBaseUrl = true;
                                      }
                                      bot.startConversation(message, function(err, convo) {
                                          convo.ask("What is the URL or your Axosoft account? i.e. https://example.axosoft.com", function(response, convo) {
                                          var baseUrl = module.exports.formatAxosoftBaseUrl(response.text.replace(/[<>]/g, ''));
                                          module.exports.makeRequest('GET', baseUrl + '/api/version', {}, function(error, response, body){
                                            if(!error && response.statusCode == 200){
                                              var Body = JSON.parse(body);
                                              if(Body.data.hasOwnProperty("revision") && Body.data.revision >= 11218){
                                                var axosoftLoginUrl = module.exports.axosoftLoginUrlBuilder(baseUrl, message);
                                                if(saveAxoBaseUrl){
                                                  module.exports.saveAxosoftUrl(message, baseUrl);
                                                }
                                                convo.stop();
                                                module.exports.retrieveDataFromDataBase(message.team, message.user,"teams")
                                                  .then(function(returnedDataFromDb){
                                                    var slackToken = returnedDataFromDb.slackAccessToken;
                                                    module.exports.sendTextToSlack(slackToken, message.channel, `I need permissions to talk to your Axosoft account. <${axosoftLoginUrl}|Click here to Authorize>`);
                                                  })
                                                  .catch(function(reason){
                                                    //can not get slackToken from DB
                                                    module.exports.sendTextToSlack(slackToken, message.channel, "There was an error authorizing your account"); 
                                                  })
                                              }
                                              else{
                                                convo.say("Please upgrade your installation to Axosoft 17 or later");
                                                convo.next();
                                              }
                                            }else{
                                              convo.say("Not a valid Axosoft URL");
                                              convo.next();
                                            }
                                          });
                                          });
                                      });
                                })
                                  .catch(function(reason){
                                    console.log(reason);
                                  });
},

textBuilder: function(message){
                return new Promise(function(resolve, reject){
                            var requestedKeyWord = function(msg){
                              if(msg != "")return msg;
                              else return "";
                            };
                            var ofYourConditional = message.match.input.includes("my") ? 'of your ' : '';
                            var baseTxt = `I could not find any ${ofYourConditional}${requestedKeyWord(message.match[2])}${requestedKeyWord(message.match[3])}`;
                            resolve(baseTxt);
                });
},

paramsBuilder: function(axosoftUrl, axosoftToken, slackToken, message){
                  return new Promise(function(resolve, reject){
                      var params = {
                        access_token: axosoftToken,
                        columns: "name,id,item_type,priority,due_date,workflow_step,description,remaining_duration.duration_text,assigned_to,release,percent_complete,custom_fields.custom_1",
                        page_size: 10,
                        //default sort created_date_time desc
                        sort_fields: 'created_date_time DESC'
                      };
                      var keyWord = message.match[2].toLowerCase();

                      //paging
                      var page = 1;
                      var pageMatches = message.text.match(/(.*)(page\s)(\d+)/i);
                      if (pageMatches){
                        page = pageMatches[3];
                          params.page = page;
                      }

                      if(keyWord == 'open '){
                        params.filters = 'completion_date="1899-01-01"';
                        params.sort_fields = 'last_updated_date_time DESC';
                      }else if(keyWord == 'closed '){
                        params.filters = 'completion_date=in[last30_days]';
                        params.sort_fields = 'completion_date DESC,last_updated_date_time DESC';
                      }else if(keyWord == 'updated '){
                        params.sort_fields = 'last_updated_date_time DESC';
                      }else if(keyWord== 'ranked '){
                        params.sort_fields = 'rank';
                      }else if(keyWord == 'upcoming '){
                        var today = new Date();
                        Date.prototype.addDays = function(days){
                            var date = new Date(this.valueOf());
                            date.setDate(date.getDate() + days);
                            return date;
                        }
                        params.due_date = `[${today.addDays(-90).toISOString()}=${today.addDays(14).toISOString()}]`;
                        params.filters = 'completion_date="1899-01-01"';
                        params.sort_fields = 'due_date,last_updated_date_time DESC'
                      }else if(keyWord != ""){
                        module.exports.sendTextToSlack(slackToken, message.channel,"I don't understand what you want me to do. You can ask me 'help' for a list of supported commands");
                        reject("vague Request");
                      }

                      if(message.match[1] == 'get my'){
                          module.exports.getUserIdAxosoft(axosoftUrl, axosoftToken, slackToken, message)
                            .then(function(userIdAxo){
                                params.filters = params.filters + `,assigned_to.id=${userIdAxo}`;
                                return resolve(params);
                            }).catch(function(reason){
                                return reject(reason);
                            })
                      }
                      else{
                        return resolve(params);
                      }
                  });
},

getParamsFromQueryString: function(query){
                              var object = new Object();
                              var params = query.state.split("&");
                              params.forEach(function(param) {
                                var kvp = param.split("=");
                                object[kvp[0]] = kvp[1];
                              });
                              return object;
},

formatAxosoftItemData: function(item){
  var fieldsArray = [];

  Array.prototype.attachData = function(obj){
  if(obj.value.length > 0)
  this.push(obj);
};

  fieldsArray.attachData({
    title: 'Project',
    value: item['project'],
    short: true
  });

  fieldsArray.attachData({
    title: 'Release',
    value: item['release'],
    short: true
  });

  fieldsArray.attachData({
    title: 'Workflow Step',
    value: item['workflow_step'],
    short: true
  });

  fieldsArray.attachData({
    title: 'Assigned To',
    value: item['assigned_to'],
    short: true
  });

  fieldsArray.attachData({
    title: 'Priority',
    value: item['priority'],
    short: true
  });

  if(item.hasOwnProperty("remaining_duration")){
    fieldsArray.attachData({
      title: 'Remaining Estimate',
      value: item['remaining_duration']['duration_text'],
      short: true
    });
  }

  if (item['parent']['id'] > 0 ){
    fieldsArray.attachData({
      title: 'Parent',
      value: `<${item.parent_link}|${item.parent.id}>`,
      short: true
    });
  }

  //if work item type exists
  if(item['custom_fields'] != undefined){
    fieldsArray.attachData({
      title: 'Work Item Type',
      value: item['custom_fields'],
      short: true
    });
  }

  if(item.hasOwnProperty("description")){
    fieldsArray.attachData({
      title: 'Description',
      value: module.exports.trimDescription(item['description']),
      short: false
    });
  }

  return fieldsArray;
},

trimDescription: function(description){
                    if (description.length > 900) {
                      for(d=900; d > 0; d--){
                        if(description.charAt(d) == " "){
                          description = description.slice(0, d) + '...';
                          break;
                        }
                      }
                    }
                    return description;
},

axosoftDataBuilder: function(baseUrl, data){
                        var axosoftData = new Object();
                        var propertyName = null;
                        axosoftData.link = `${baseUrl}/viewitem?id=${data.id}&type=${data.item_type}&force_use_number=true/`;
                        axosoftData.parent_link = `${baseUrl}/viewitem?id=${data.parent.id}&type=${data.item_type}&force_use_number=true/`;
                        for(z=0; z < Object.keys(data).length; z++){
                            propertyName = Object.keys(data)[z];

                            if(!(data[propertyName] === null) && !(data[propertyName] === "")){
                                if(data[propertyName].hasOwnProperty("name")){
                                  axosoftData[propertyName] = (data[propertyName].name == null) ? "" : data[propertyName].name;
                                }else if(propertyName == "description"){
                                  var description = (data[propertyName].length > 900)? module.exports.trimDescription(entities.decodeHTML(data[propertyName])): entities.decodeHTML(data[propertyName]);
                                  axosoftData[propertyName] = striptags(description);
                                }else if(propertyName == "due_date"){
                                  axosoftData[propertyName] = module.exports.timeFormat(data[propertyName]);
                                }else{
                                  axosoftData[propertyName] = (data[propertyName] == null) ? "" : data[propertyName];
                                }
                            }
                        }
                        return axosoftData;
},

axosoftApiMethod: function(Axo, itemType){
                      if(itemType == "tasks"){
                        return Axo.axosoftApi.Tasks;
                      }else if(itemType == "incidents"){
                        return Axo.axosoftApi.Incidents;
                      }else if(itemType == "defects"){
                        return Axo.axosoftApi.Defects;
                      }else{
                        return Axo.axosoftApi.Features;
                      }
},

axosoftFiltersBuilder: function(bot, message){
                          return new Promise(function(resolve, reject){
                              module.exports.checkAxosoftDataForUser(bot, message)
                              .then(function(axosoftData){
                                 var nodeAxo = new nodeAxosoft(axosoftData.axosoftBaseURL, axosoftData.axosoftAccessToken);
                                 var argArray = ["features"];
                                 nodeAxo.promisify(nodeAxo.axosoftApi.Filters.get, argArray)
                                 .then(function(filters){
                                   resolve(filters);
                                 })
                                 .catch(function(reason){
                                   console.log(reason);
                                   reject(reason);
                                 });
                              })
                              .catch(function(reason){
                                  console.log(reason);
                                  module.exports.createNewCollection(message)
                                  .then(function(val){

                                  })
                                  .catch(function(reason){
                                    console.log("Something went wrong with building a collection for the new user in the database!");
                                  });
                              });
                          });
},

actionArrayMaker: function(filters){
                      var actions = [];
                      for(c=0; c < filters.length; c++){
                        actions.push({
                            "name": `${filters[c].name}`,
                            "text": `${filters[c].name}`,
                            "type": "button",
                            "value": `${filters[c].id}`
                        });
                      }
                      return actions;
},

attachmentsArrayMakerForInteractiveButtons: function(actions){
                                                  var mainArray = [];
                                                  var attachments = [];
                                                  //TODO 5 should not be hardcoded
                                                  var index = 0;
                                                  for(x=0; x < 5; x++){
                                                      attachments = [{
                                                          "fallback": "You are unable to choose a filter",
                                                          "callback_id": "select_filter",
                                                          "color": "#3AA3E3",
                                                          "attachment_type": "default",
                                                          "actions":[]
                                                      }];

                                                      for(z=0; z < 5; z++){ //5 is max count of buttons in a row (slack restriction)
                                                        if(index == actions.length){
                                                          attachments[0].actions.push({
                                                                  "name": "noFilter",
                                                                  "text": "No Filter",
                                                                  "type": "button",
                                                                  "style": "primary",
                                                                  "value": "noFilter"
                                                           });
                                                           index++;
                                                           break;
                                                        }else if(index < actions.length){
                                                           attachments[0].actions.push({
                                                                  "name": `${actions[index].name}`,
                                                                  "text": `${actions[index].text}`,
                                                                  "type": "button",
                                                                  "value": `${actions[index].value}`
                                                           });
                                                          index++;
                                                        }
                                                      }
                                                      mainArray.push(attachments[0]);
                                                  }
                                                  return mainArray;
},

filterButtons: function(bot, message, filters){
                      var actionsArray = module.exports.actionArrayMaker(filters); 
                      var attachs = module.exports.attachmentsArrayMakerForInteractiveButtons(actionsArray);
                      var slackToken;
                      module.exports.retrieveDataFromDataBase(message.team, message.user,"teams")
                      .then(function(returnedData){
                          slackToken = returnedData.slackAccessToken;
                          var params = {
                                  token: slackToken,
                                  channel: message.channel,
                                  text: "Which filter would you like to use?",
                                  attachments:JSON.stringify(attachs)
                          };
                          module.exports.makeRequest("POST","https://slack.com/api/chat.postMessage", params, function(err, response, body){});
                      })
                      .catch(function(reason){
                          console.log(reason);
                      });
},

saveAxosoftFilter: function(data){
                    var userId = data.user.id;
                    var teamId = data.team.id;
                    //TODO make sure document exists before you store the axosoftFilter in da database
                    
                    MongoClient.connect(config.mongoUri,function(err, database){
                      if(err){
                        return console.log(err);
                      }else{
                        var test = database.collection('users').findAndModify(
                           {id: userId, team_id: teamId},
                           [],
                           {$set: {axsoftFilter: data.actions[0]}},
                           {},
                           function(err, object){
                              if (err){
                                  console.warn(err.message); 
                              }else{
                                  console.dir(object);
                              }
                           }
                        );
                      }
                    });
},

validateRequstedPageNumber: function(message){
                              if(message[4].toLowerCase().includes("page")){
                                var pagingText = message[4].match(/(.*)(page\s)((-[0-9]+)|([0-9]+))/);
                                if(pagingText != null && pagingText[5] != 0 && pagingText[5] < 2147483647){
                                  return true;
                                }else{
                                  return false;
                                }
                              }else{
                                return true;
                              }
},

logRequestToDB: function(axosoftUrl, method){
                        //only log if Config option set
                        if (config.LogToDB) {
                          return new Promise(function(resolve, reject){
                                MongoClient.connect(config.mongoUri, function(err, database){
                                    if(err) return console.log(err);
                                    database.collection('log').insertOne({
                                      axosoftUrl: axosoftUrl,
                                      method: method,
                                      ts: new Date()
                                    });
                                    database.close();
                                    resolve("");
                                });
                          });
                        }
},

  postSingleItemToSlack: function (bot, message, item_type, item_id, link) {
    var channelId = message.channel;

    var columns = "name,id,priority,due_date,workflow_step,remaining_duration.duration_text,item_type,assigned_to,release,description";
    var formatDueDate = function (dueDate) {
      if (dueDate == null) return '';
      else return '*Due Date:* ' + module.exports.timeFormat(dueDate);
    };

    var formatColumns = function (itemType) {
      if (itemType != "features") {
        return columns;
      }
      else {
        return columns + ",custom_fields.custom_1";
      }
    };

    var formatWorkItemType = function (workItemType) {
      if (workItemType == null) return '';
      else {
        return `\n *Work Item Type:* ${axosoftData.workItemType}`;
      }
    };

    module.exports.checkAxosoftDataForUser(bot, message)
      .then(function (userData) {
        module.exports.retrieveDataFromDataBase(message.team, message.user, "teams")
          .then(function (returnedData) {
            var axoBaseUrl = returnedData.axosoftBaseURL;
            var slackToken = returnedData.slackAccessToken;
            
            // log to db
            module.exports.logRequestToDB(axoBaseUrl, 'getOne'); 

            // check to ensure link is for account
            if (link && message.match[0].indexOf(axoBaseUrl) < 0 ) {
              return;
            }
            else if (item_id > 2147483647) {
              module.exports.sendTextToSlack(slackToken, channelId, `I could not find item \`# ${item_id}\``);
            } else  {
              var params = {};
              params.access_token = userData.axosoftAccessToken;
              params.columns = formatColumns(item_type);
              params.page_size = 1;

              if (item_type === 'incidents') {
                params.search_field = 'number';
                params.search_string = item_id;
              }
              else { params.filters = `id=${item_id}`; }

              var args = [params];
              var nodeAxo = new nodeAxosoft(axoBaseUrl, userData.axosoftAccessToken);
              nodeAxo.promisify(module.exports.axosoftApiMethod(nodeAxo, item_type).get, args)
                .then(function (response) {
                  if (response.data.length == 0) {
                    module.exports.sendTextToSlack(slackToken, channelId, `I could not find item \`# ${message.match[5]}\``);
                  } else {
                    var axosoftData = module.exports.axosoftDataBuilder(axoBaseUrl, response.data[0]);
                    var params = {
                      token: slackToken,
                      channel: channelId,
                      mrkdwn: true,
                      attachments: JSON.stringify([{
                        color: "#38B040",
                        fallback: `${axosoftData.number}: ${axosoftData.name}`,
                        text: `<${axosoftData.link}|${axosoftData.number}>: ${axosoftData.name}${axosoftData.has_attachments ? ' :paperclip:' : ''}`,
                        fields: module.exports.formatAxosoftItemData(axosoftData),
                        mrkdwn_in: ["text"]
                      }])
                    };
                    module.exports.makeRequest("GET", "https://slack.com/api/chat.postMessage", params, function (err, response, body) { });
                  }
                })
                .catch(function (error) {
                  console.log(error.statusCode);
                  if (error.statusCode == 401) {
                    module.exports.setAxosoftAccessToken(bot, message, axoBaseUrl);
                  }
                });
            }
            var nodeAxo = new nodeAxosoft(axoBaseUrl, args[0].access_token);
          })
          .catch(function (reason) {
            console.log(reason);
          })
      })
      .catch(function (reason) {
        console.log(reason);
        if (reason == "No collection") {
          module.exports.createNewCollection(message)
            .then(function (val) {
              module.exports.authorizeUserwithoutCollection(bot, message);
            }).catch(function (reason) {
              //TODO not a bad idea to slack user! 
              console.log("Something went wrong with building a collection for the new user in the database!");
            })
        }
      });
  }

};