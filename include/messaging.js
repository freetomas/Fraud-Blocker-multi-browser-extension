
function updateLocalList(ns,add){
        if(add)
        localList[ns]=1;
        else
        delete localList[ns];
        storage.set({local: JSON.stringify(localList)});
        //if(chrome.runtime.lastError)
        //  console.log(chrome.runtime.lastError);
}

function updateLocalConList(ns,add){
        if(add)
        localConList[ns]=1;
        else
        delete localConList[ns];
        storage.set({localCon: JSON.stringify(localConList)});
}

/*
*  Given a url return the status of the page in the database.
*  It checks from the SLD to the last domain
*  The nameserver that match is returned as result.
*  (This preserves the Hierarchic structure of DNS names)
*  In other words, if a nameserver is bad, all his derivates
*  are bad too.
*/
function getStatus(url){
        //if the url is the "blocked" page, then retrieve the blocked URL
        if(url.split('?')[0]==chrome.extension.getURL('web/black.html'))
        return {ns:"",msg:"blocked"}

        var ret={}, prec=null, current='', level=2, ns=extractNS(url), check_sublease=false;
        //handle the empty case
        if(ns=="" || ns.substring(0,firefoxInternalProtocol.length)==firefoxInternalProtocol )
        return {ns:"",msg:"white"};
        //if visiting an IP instead of a NS, ignore it anyway
        if(/^(?!.*\.$)((?!0\d)(1?\d?\d|25[0-5]|2[0-4]\d)(\.|$)){4}$/.test(ns) )
        return {ns:"",msg:"white"};

        while(prec!=current){
                prec=current;
                ret.ns=current=extractSubNS(ns,level++);

                if(localList[current]!=null)
                ret.local=true;
                else if(localConList[current]!=null)
                ret.conLocal=true;

                if(subleasesList[current]!=null){
                        ret.msg="white";
                        check_sublease=true;
                }
                else if(whiteList[current]!=null){
                        ret.msg= "white";
                        break;
                }
                else if(blackList[current]!=null){
                        if(blackListIgnore[current]!=null)
                        ret.msg="ignored";
                        else
                        ret.msg= "black";
                        break;
                }
                else if(greyList[current]!=null){
                        ret.msg= "grey";
                        ret.nFraud=greyList[current].reports;
                        ret.nGood=greyList[current].contro_reports;
                        break;
                }
                else{
                        if(prec==current && check_sublease) //no subdomain to check, return white
                        break;
                        ret.msg="";
                        continue;
                }
        }
        return ret;
}

/*
*  Identify how the site on the current tab is recognized by the local database.
*  The procedure is the following:
*  If the domain to check is fun.links.co.uk,
*  First is checked co.uk, if there's a FLAG for it, the function terminates.
*  If there's nothing the function continues with links.co.uk .. etc ..
*
*  This is the best way I figured out to detect determined domains based on NS structure.
*/
function notify(sendResponse){
        chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
                var ret=getStatus(tabs[0].url);
                sendResponse(ret);
        });
}

/*
*  Send a GET request synchronously and return the responseText
*/
function sendGET(actionType, ns, url, func, onTimeout){
        var request = new XMLHttpRequest();
        var type = (actionType==reportUrl)?0:(actionType==conReportUrl)?1:(actionType==avoidReportUrl)?2:(actionType==avoidConReportUrl)?3:-1;
        request.open("GET", actionType+'?ns='+ns+'&url='+encodeURI(url), true);
        request.timeout = reqDefaultTimeout;
        request.onload = function(){  func(request.responseText);   };
        request.ontimeout = function(){ onTimeout(ns, url, type); };
        request.onerror = function(){ onTimeout(ns, url, type); };
        request.send();
}

/*
*  Function that runs on the background context and execute functions for content_script.js and
*  for popup.js.
*  Function performed are:
*    +check a nameserver
*    +ignore black site for this session
*    +report,avoidReport,controReport,avoidControReport
*/
var blackListIgnore={};
var performing=false;
function messageHandler( msg, sender, sendResponse ){
        // Only accepts messages from Fraud Blocker
        if(sender.extensionId!==chrome.runtime.id)
        return false;

        if(msg.msg=="check"){
                notify(sendResponse);
        }
        // the user is asking to ignore the black-listed site through the popup
        else if(msg.msg=='ignore'){
                chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
                        if(tabs[0].url.substring(0,firefoxExtensionsProtocol.length)==firefoxExtensionsProtocol)
                        blockedURL = decodeURIComponent(tabs[0].url.split('?')[1])
                        else
                        blockedURL = tabs[0].url
                        ns=current=extractNS(blockedURL), prec='', level=2;
                        while(prec!=current){
                                prec=current;
                                blackListIgnore[current]=1;
                                current=extractSubNS(ns, level++);
                        }
                        chrome.tabs.update(tabs[0].id, { url: blockedURL });
                });
        }
        else{
                if(performing)
                return false;
                performing=true;

                var ret=getStatus(msg.ns);
                msg.ns=ret.ns;

                var URL=null;
                var add=null;	//true when adding to tables, false when removing (avoiding reports)
                var con=false;	//true when reporting site as non-fraudulent

                var onTimeout = function(ns, url, type){
                        sendResponse({result: 'timeout'});

                        var present=false,i=0;
                        while(i<any_pending_reports.length){ //is it already in the list?
                                if(any_pending_reports[i].report==ns){
                                        present=true;
                                        break;
                                }
                                i++;
                        }

                        if(!present){  //it's not in the list, push!
                                any_pending_reports.push({ report: ns, url: url, report_type: type});
                                storage.set({pendingReports: JSON.stringify(any_pending_reports)});
                        }
                };

                if(msg.type=='report'){
                        URL=reportUrl;
                        add=true;
                }
                else if(msg.type=='avoidReport'){
                        URL=avoidReportUrl;
                        add=false;
                }
                else if(msg.type=='conReport'){
                        con=true;
                        URL=conReportUrl;
                        add=true;
                }
                else if(msg.type=='avoidConReport'){
                        con=true;
                        URL=avoidConReportUrl;
                        add=false;
                }
                else if(msg.type=='avoidAny'){
                        var failed=false;
                        if(localList[msg.ns]!=null){
                                URL=avoidReportUrl;
                                add=false;
                        }
                        else if(localConList[msg.ns]!=null){
                                con=true;
                                URL=avoidConReportUrl;
                                add=false;
                        }
                        else
                        failed=true;
                        if(failed){
                                sendResponse({result: 'fail'});
                                performing=false;
                                return true;
                        }
                }
                if ( (con && ((add && localConList[msg.ns]!=null) || (!add && localConList[msg.ns]==null)) ) ||
                (!con && ((add && localList[msg.ns]!=null) || (!add && localList[msg.ns]==null)) )){
                        sendResponse({result: 'fail'});
                }
                else{
                        sendGET(URL, msg.ns, msg.url,
                                function(response){
                                        if(response.indexOf('ok') != -1){
                                                msg.ns = response.split(" ")[1];
                                                if(con){
                                                        updateLocalConList(msg.ns,add);
                                                        if(localList[msg.ns]!=null){
                                                                sendGET(avoidReportUrl, msg.ns, msg.url,
                                                                        function(response){
                                                                                if(response.indexOf('ok')!=-1){
                                                                                        updateLocalList(msg.ns,false);
                                                                                        sendResponse({result: 'ok', ns: msg.ns});
                                                                                }
                                                                                else{
                                                                                        updateLocalConList(msg.ns,!add);
                                                                                        sendResponse({result: 'fail'});
                                                                                        performing=false;
                                                                                }
                                                                        },onTimeout);
                                                                }
                                                                else
                                                                sendResponse({result: 'ok', ns: msg.ns});
                                                        }
                                                        else{
                                                                updateLocalList(msg.ns,add);
                                                                if(localConList[msg.ns]!=null){
                                                                        sendGET(avoidConReportUrl, msg.ns, msg.url,
                                                                                function(response){
                                                                                        if(response.indexOf('ok')!=-1){
                                                                                                updateLocalConList(msg.ns,false);
                                                                                                sendResponse({result: 'ok', ns: msg.ns});
                                                                                        }
                                                                                        else{
                                                                                                updateLocalList(msg.ns,!add);
                                                                                                sendResponse({result: 'fail'});
                                                                                                performing=false;
                                                                                        }
                                                                                },onTimeout);
                                                                        }
                                                                        else
                                                                        sendResponse({result: 'ok', ns: msg.ns});
                                                                }
                                                        }
                                                        else{
                                                                sendResponse({result: 'fail'});
                                                        }
                                                },
                                                onTimeout);
                                        }
                                        performing=false;
                                }
                                return true;	//return true if sendResponse run after the function returns
                        }
