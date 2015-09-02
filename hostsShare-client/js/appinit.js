﻿var os = require('os');
var fs = require('fs');
var request = require('request');

var appGui = require('nw.gui'),
    appWin = appGui.Window.get();
var proxyServer, menuHostsMode, menuProxyMode;
var codeMirror;

var app = {};
app.bHide = false;

var hostsShareApi = '';
var username = 'test';
var argv = appGui.App.argv;
if(argv.length > 0){
    hostsShareApi = argv[0];
    username = argv[1];
}

var config = {};
var workMode = 'hosts';

app.initHostsMode = function(){
    var keyMaps = {};
    keyMaps[ctrlKey+'-Q'] = function(){
        app.toogleEditorLine(true);
    };
    keyMaps[ctrlKey+'-/']=function() {
        app.toogleEditorLine();
    }
    keyMaps[ctrlKey+'-G']=function() {
        app.addNewGroup();
    }
    keyMaps[ctrlKey+'-S'] = app.setHosts;
    var jDivHostsMode = $('#divHostsMode');
    codeMirror = CodeMirror(jDivHostsMode[0], {
        lineNumbers: true,
        fixedGutter: true,
        theme: 'Bespin',
        extraKeys: keyMaps
    });
    codeMirror.on('change', app.setHosts);
    codeMirror.focus();
    // 右键菜单
    var contextMenu = new appGui.Menu();
    var cutMenu = new appGui.MenuItem({
        label: '剪切',
        click: function () {
            document.execCommand('cut');
        }
    });
    var copyMenu = new appGui.MenuItem({
        label: '复制',
        click: function () {
            document.execCommand('copy');
        }
    });
    var pasteMenu = new appGui.MenuItem({
        label: '粘贴',
        click: function () {
            document.execCommand('paste');
        }
    });
    contextMenu.append(cutMenu);
    contextMenu.append(copyMenu);
    contextMenu.append(pasteMenu);
    jDivHostsMode.on('contextmenu', function (e) {
        e.preventDefault();
        var selectionType = window.getSelection().type.toUpperCase();
        var clipData = appGui.Clipboard.get().get();
        cutMenu.enabled = selectionType === 'RANGE';
        copyMenu.enabled = selectionType === 'RANGE';
        pasteMenu.enabled = clipData.length > 0;
        app.updateGroupMenu(contextMenu);
        contextMenu.popup(e.originalEvent.x, e.originalEvent.y);
    });
}

app.updateGroupMenu = function(contextMenu){
    var hosts = codeMirror.getValue();

    var arrHosts = hosts.split(/\r?\n/g);

    var arrGroups = [], lastGroupName = null, lastGroupAttr, lastGroupCount = 0, lastGroupOnCount = 0;
    arrHosts.forEach(function(line) {
        var match = line.match(/^\s*#\s*=+\s*([^=]+?)\s*((?:\([^\(\)=]+\))*)\s*=+/i);
        if(match !== null){
            if(lastGroupName !== null){
                arrGroups.push({name:lastGroupName,data:lastGroupAttr, on:(lastGroupOnCount>0 && lastGroupOnCount === lastGroupCount)});
            }
            lastGroupName = match[1];
            lastGroupAttr = match[2];
            if(lastGroupAttr){
                lastGroupAttr = lastGroupAttr.replace(/\)\s*\(/g,',').replace(/\s*[()]\s*/g,'');
            }
            lastGroupCount = lastGroupOnCount = 0;
        }
        else{
            if(/^\s*(#[^!]|$)/.test(line) === false){
                lastGroupCount ++;
                if(/^\s*#!/.test(line) === false){
                    lastGroupOnCount ++;
                }
            }
        }
    });
    if(lastGroupName !== null){
        arrGroups.push({name:lastGroupName, data:lastGroupAttr, on:(lastGroupOnCount>0 && lastGroupOnCount === lastGroupCount)});
    }

    var menuitem;
    for (var i = contextMenu.items.length-1; i >-1 ; i--) {
        menuitem = contextMenu.items[i];
        if(menuitem.label === '粘贴'){
            break;
        }
        contextMenu.remove(menuitem);
    }
    if(arrGroups.length > 0){
        contextMenu.append(new appGui.MenuItem({ type: 'separator' }));
        arrGroups.forEach(function(group) {
            var menuItemGroup = new appGui.MenuItem({
                type: 'checkbox',
                label: group.name,
                click: function () {
                    app.setGroup(group.name, !group.on, group.data);
                }
            });
            menuItemGroup.checked = group.on;
            contextMenu.append(menuItemGroup);
        });
    }
}

app.setGroup = function(name, bOn, data){
    var textHosts = codeMirror.getValue();
    var arrTextHosts = textHosts.split(/\r?\n/g);
    var groupName = null, arrGroupOn = {};
    if(bOn && data){
        //开启时才检测关联性
        var arrData = data.split(',');
        arrData.forEach(function(attr){
            attr = attr.toLowerCase();
            if(attr.substr(0,1) === '?'){
                arrGroupOn[attr.substr(1)] = true;
            }
            else{
                groupName = attr;
            }
        });
    }

    var targetGroupLine;
    var bGroupOn = null;
    var line;
    for(var i=0,c=arrTextHosts.length;i<c;i++){
        line = arrTextHosts[i];
        var match = line.match(/^\s*#\s*=+\s*([^=]+?)\s*((?:\([^\(\)=]+\))*)\s*=+/i);
        if(match !== null){
            bGroupOn = null;
            if(match[1] === name || name === ''){
                bGroupOn = bOn;
                targetGroupLine = i;
            }
            else if(arrGroupOn[match[1].toLowerCase()]){
                //被依赖，开启
                bGroupOn = true;
            }
            else if(groupName !== null && match[2]){
                match = match[2].match(/\(\s*([^\?].*?)\s*\)/);
                if(match && match[1] && groupName === match[1].toLowerCase()){
                    //同组，互斥
                    bGroupOn = false;
                }
            }
        }
        else{
            if(bGroupOn !== null){
                if(bGroupOn){
                    line = line.replace(/^\s*#!\s*/,'');
                }
                else{
                    line = line.replace(/^\s*([^#])/,'#! $1');
                }
            }
        }
        arrTextHosts[i] = line;
    };
    textHost = arrTextHosts.join('\r\n');

    codeMirror.setValue(textHost);

    if(name === ''){
        targetGroupLine = 0;
    }
    if(targetGroupLine){
        codeMirror.setCursor({line:targetGroupLine,ch:0});
        var pos = codeMirror.charCoords({line:targetGroupLine,ch:0}, 'local');
        codeMirror.scrollTo(pos.left, pos.top);
    }
}

var groupId = 1;
app.addNewGroup = function(){
    var fromLine = codeMirror.getCursor(true).line, strLine;
    var regGroup = /^\s*#\s*=+[^=]+=+/;
    strLine = codeMirror.getLine(fromLine);

    var strGroupId = 'group ' + groupId++;
    codeMirror.setLine(fromLine, '\r\n# ==================== ' + strGroupId + ' ====================\r\n\r\n' + strLine);
    codeMirror.setSelection({line:fromLine+1, ch:23}, {line:fromLine+1, ch:23 + strGroupId.length});
}

app.toogleEditorLine = function(bPlusMode){
    var from = codeMirror.getCursor(true), fromLine = from.line,
        to = codeMirror.getCursor(false), toLine = to.line;
    var bNotLineStart = (from.ch > 0);
    var strLine, match;
    for (var i = fromLine; i <= toLine; i++) {
        strLine = codeMirror.getLine(i);
        match = strLine.match(/^\s*(.)(.)/);
        if(match){
            if (match[1] === '#') {
                if(!/^\s*#\s*=+[^=]+=+/.test(strLine) && (!bPlusMode || (bPlusMode && match[2] === '!'))){
                    //开启
                    strLine = strLine.replace(/^\s*#!?\s*/, function(all){
                        var changeLen = all.length;
                        if(bNotLineStart && i === fromLine)from.ch-=changeLen;
                        if(i === toLine)to.ch-=changeLen;
                        return '';
                    });
                    codeMirror.setLine(i, strLine);
                }
            } else {
                //关闭
                strLine = strLine.replace(/^\s*/, function(all){
                    var commentTag = bPlusMode?'#! ':'# ';
                    var changeLen = commentTag.length - all.length;
                    if(bNotLineStart && i === fromLine)from.ch+=changeLen;
                    if(i === toLine)to.ch+=changeLen;
                    return commentTag;
                });
                codeMirror.setLine(i, strLine);
            }
        }
    }
    codeMirror.setSelection(from, to);
}

app.initForwardMode = function(){
    var jTxtForwardHost = $('#forwardHost'),
        jTxtForwardPort = $('#forwardPort'),
        jBtnSaveProxy = $('#saveProxy');
    jBtnSaveProxy.click(function(){
        var strTargetHost = jTxtForwardHost.val(),
            strTargetPort = jTxtForwardPort.val();
        if(strTargetHost && strTargetPort){
            app.setForward();
        }
        else{
            alert('请输入代理服务器和端口号。')
        }
    });
}

app.setWorkMode = function(mode){
    var jDivHostsMode = $('#divHostsMode'),
        jDivProxyMode = $('#divProxyMode');
    var jSpanWordMode = $('#wordMode');
    if(mode === 'forward'){
        workMode = 'forward';
        jSpanWordMode.text('代理模式');
        app.setForward();
        menuHostsMode.checked = false;
        menuProxyMode.checked = true;
        jDivHostsMode.hide();
        jDivProxyMode.css('display', 'table-cell');
        $('#forwardHost')[0].focus();
    }
    else{
        workMode = 'hosts';
        jSpanWordMode.text('hosts模式');
        app.setHosts();
        menuHostsMode.checked = true;
        menuProxyMode.checked = false;
        jDivHostsMode.show();
        jDivProxyMode.hide();
        codeMirror.focus();
    }
}

app.setHosts = function(){
    var hosts = codeMirror.getValue();
    // 设置hosts模式
    request(hostsShareApi + 'sethosts?name='+encodeURIComponent(username)+'&hosts='+encodeURIComponent(hosts));
}

app.setForward = function(){
    var forwardHost = $('#forwardHost').val();
    var forwardPort = $('#forwardPort').val();
    // 设置forward模式
    request(hostsShareApi + 'setforward?name='+encodeURIComponent(username)+'&forwardHost='+encodeURIComponent(forwardHost)+'&forwardPort='+encodeURIComponent(forwardPort));
}

app.hide = function(){
    appWin.hide();
    app.bHide = true;    
}

app.show = function(){
    appWin.restore();
    app.bHide = false;
}

app.initConfig = function(){
    request(hostsShareApi+'getconfig?name='+encodeURIComponent(username), function(error, response, body){
        if (!error && response.statusCode == 200) {
            try{
                var config = JSON.parse(body);
                codeMirror.setValue(config.hosts || '');
                var jTxtForwardHost = $('#forwardHost');
                var jTxtForwardPort = $('#forwardPort');
                jTxtForwardHost.val(config.forwardHost || '');
                jTxtForwardPort.val(config.forwardPort || '');
                workMode = config.mode;
                app.setWorkMode(workMode);
            }
            catch(e){}
        }
    });
}

// 初始化系统栏图标
var MenuItem = appGui.MenuItem;

var systemTray = new appGui.Tray({ title: 'Tray', icon: 'img/icon.png' });

var menuTray = new appGui.Menu();
 
menuHostsMode = new MenuItem({ type:'checkbox', label: 'hosts模式' });
menuHostsMode.on('click', function(){
    app.setWorkMode('hosts');
});

menuProxyMode = new MenuItem({ type:'checkbox', label: '代理模式' });
menuProxyMode.on('click', function(){
    app.setWorkMode('forward');
});

var menuExit = new MenuItem({ label: '退出' });
menuExit.on('click', function(){
    appWin.close(true);
});


menuTray.append(menuHostsMode);
menuTray.append(menuProxyMode);
menuTray.append(new MenuItem({ type: 'separator' }));
menuTray.append(menuExit);

systemTray.menu = menuTray;

systemTray.on('click', function(){
    if(app.bHide){
        app.show();
    }
    else{
        app.hide();
    }
});

app.initHostsMode();

app.initForwardMode();

app.initConfig();

appWin.maximize();

$('#workTip').click(function(){
    app.setWorkMode(workMode === 'hosts' ? 'forward' : 'hosts');
});