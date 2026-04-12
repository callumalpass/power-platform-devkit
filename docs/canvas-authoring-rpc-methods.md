# Canvas Authoring RPC Method Catalog

This is a generated catalog of method ids observed in the Power Apps Studio `AppMagic.WebAuthoring.js` bundle. These are not standalone REST endpoints; they are document-server RPC methods sent through `/api/v2/invoke` or the SignalR messaging channel.

Treat this as discovery aid, not a public API contract. Method names, object ids, DTO shapes, and sequencing can change with Studio builds.

## Source

```text
file: /tmp/powerapps-js/AppMagic.WebAuthoring.js
size: 956650 bytes
modified: 2026-04-12T05:00:59.394Z
method ids: 416
```

Extraction command:

```sh
node - <<'NODE'
const fs = require('fs');
const s = fs.readFileSync('/tmp/powerapps-js/AppMagic.WebAuthoring.js', 'utf8');
const names = [];
const re = /e\[e\.([a-z0-9_]+)=\d+\]="\1"/g;
let m;
while ((m = re.exec(s))) names.push(m[1]);
console.log(names.join('\n'));
NODE
```

## Calling Pattern

Use `pp canvas-authoring invoke` for low-level calls:

```sh
pp canvas-authoring invoke \
  --env dev \
  --app <app-id> \
  --class documentservicev2 \
  --oid 1 \
  --method keepalive
```

The method name passed to `--method` is the suffix after the class prefix. For example, `document_save` maps to `--class document --oid 2 --method save`; `documentservicev2_keepalive` maps to `--class documentservicev2 --oid 1 --method keepalive`.

Confirmed live probes:

```text
documentservicev2/1/keepalive -> 200
document/2/setsaveappcontext + document/2/save -> persisted YAML-applied label text across a fresh session
```

## Methods

### document (63)

```text
document_addconnecteddataentity
document_addwelcomescreenforafdasync
document_batchrefreshcdpdatasources
document_changecontroldynamicschemaasync
document_commitchanges
document_convertcdsconnectordatasourcestonativeasync
document_createaddinservice
document_createaimodelservice
document_createcdsdatasourcesasync
document_createcompletecompositecontrol
document_createcompletecontrol
document_createcompletecontrolbatch
document_createcompletescreenlayoutasync
document_createconnecteddatasource
document_createconnectedservice
document_createcontrol
document_createcustomwadlservice
document_createdataboundservice
document_createdefaultcardsasync
document_createhostcontrolasync
document_createhostservice
document_duplicateallcomponentsasync
document_duplicatecontrolasync
document_getunuseddatasourcesasync
document_getunusedflowsasync
document_importcomponentsasync
document_importpowerappscontrolasync
document_importpowerappscontrolsasync
document_loadstringresourceasync
document_movecontrol
document_notifydatasourceaddedtocoauthorsasync
document_notifydatasourcerefreshedtocoauthorsasync
document_notifyserviceaddedtocoauthorsasync
document_parsedatadescription
document_parserelatedtabledatadescription
document_patchconnecteddatasource
document_publishtoblobasync
document_refreshcdsdatasourcesasync
document_refreshresxwebresource
document_registeraibuilderoptionsets
document_registerdynamicfunctioninstance
document_removecontainer
document_removecontrol
document_removedatasource
document_removeresxwebresource
document_removeunusedmediaasync
document_renameserviceasync
document_replacecontroltemplate
document_replacegroupwithcontainer
document_reserveservicereference
document_save
document_setdefaultcdpmaxgetrowscountasync
document_setdefaultcdsmaxgetrowscountasync
document_switchtheme
document_testonly_setallowaccesstoglobals
document_tryrenameasync
document_tryunreserveservicereference
document_ungroup
document_unregisterserviceasync
document_updatecontrolsubtreeasync
document_updatethirdpartycontrolsasync
document_upgrademoderncontrol
document_uploadlogoasync
```

### documentservicev2 (13)

```text
documentservicev2_componenttemplatefactorycreatecontroltemplate
documentservicev2_connectsessiontogitasync
documentservicev2_controlimporterimport
documentservicev2_createbloburi
documentservicev2_creategitbranchasync
documentservicev2_disconnectappfromgit
documentservicev2_mergeandreload
documentservicev2_publishandload
documentservicev2_screentemplatefactorycreatecontroltemplate
documentservicev2_staticdataimportgetexceltables
documentservicev2_staticdataimportimportsampledata
documentservicev2_staticdataimportimporttables
documentservicev2_tryauthenticategitsessionasync
```

### documentapis (17)

```text
documentapis_applyprimarypatch
documentapis_removeunusedmedia
documentapis_saveapp
documentapis_setappdescription
documentapis_setcanvasheight
documentapis_setcanvasorientation
documentapis_setcanvasproperties
documentapis_setcanvaswidth
documentapis_setdefaultconnecteddatasourcemaxgetrowscount
documentapis_setlockorientation
documentapis_setmaintainaspectratio
documentapis_setscaletofit
documentapis_setshowmobilestatusbar
documentapis_undoredomanager_redo
documentapis_undoredomanager_undo
documentapis_ungroup
documentapis_upgrademoderncontrol
```

### (ungrouped) (250)

```text
reset
subscribe
normal
undoable
attachable
none
border
color
pen
fill
options
padding
paragraph
template
text
transparency
chart
name
hidden
editable
format
tooltip
id
version
intangible
positionable
requirements
parent
script
category
type
maximum
minimum
errors
content
attributes
kind
size
width
height
duration
children
index
_max
_min
control
service
collection
resource
alias
enum
view
theme
_lim
list
thumbnail
failed
succeeded
canceled
launch
running
suspended
terminated
_min
added
removed
renamed
changed
_lim
hold
filled
snapped
success
_min
unknown
_lim
_min
suggestion
warning
error
_lim
none
keyboard
generic
_min
unknown
performance
offline
_lim
_min
unknown
informational
low
medium
high
critical
_lim
unknown
phone
web
unknown
image
audio
video
pdf
none
above
below
css
folder
image
markup
media
other
dynamic
extension
composition
unknown
success
failure
controls
entities
unknown
none
writeable
refreshable
clearable
pageable
delegatable
selectable
succeeded
failed
app
page
_min
creation
clone
_lim
invalid
_min
_lim
success
disconnected
dynamic
teams
none
unchanged
invalid
invalid
_min
record
table
boolean
number
string
date
time
hyperlink
currency
image
color
enum
media
guid
screen
void
_lim
none
web
player
all
success
none
uri
size
width
height
duration
none
_min
added
removed
_lim
success
none
browse
detail
edit
data
design
behavior
scope
unknown
formulas
functions
static
dynamic
collection
resource
connected
intellisense
importer
persistence
publish
rule
entity
migration
_min
verbose
suggestion
warning
moderate
severe
critical
_lim
none
create
read
update
delete
none
camera
microphone
location
none
text
logical
table
behavior
information
color
component
unknown
control
data
function
alias
enum
service
punctuator
delimiter
comment
self
parent
type
_lim
_min
undo
redo
_lim
```

### documentproperties (2)

```text
documentproperties_setapppreviewflag
documentproperties_setcanvaspropertiesasync
```

### iaddfieldcommand (2)

```text
iaddfieldcommand_executeasync
iaddfieldcommand_executemanyasync
```

### iaddsearchrulecommand (1)

```text
iaddsearchrulecommand_executeasync
```

### iaddsuggestedsmartfieldscommand (1)

```text
iaddsuggestedsmartfieldscommand_executeasync
```

### iapplydatasourcelayoutcommand (1)

```text
iapplydatasourcelayoutcommand_executeasync
```

### iapplytodescendantsaction (1)

```text
iapplytodescendantsaction_executeasync
```

### iapplytodescendantscommand (1)

```text
iapplytodescendantscommand_executeasync
```

### iautobindappcommand (1)

```text
iautobindappcommand_executeasync
```

### ibatchrenamecommand (1)

```text
ibatchrenamecommand_executeasync
```

### icaptureschemacommand (1)

```text
icaptureschemacommand_executeasync
```

### icdpdatasource (1)

```text
icdpdatasource_updatemaxgetrowscountasync
```

### icdsdatasource (1)

```text
icdsdatasource_updatemaxgetrowscountasync
```

### ichangecontrollayoutcommand (1)

```text
ichangecontrollayoutcommand_executeasync
```

### ichangefieldvariantcommand (1)

```text
ichangefieldvariantcommand_executeasync
```

### ichangerulemodelscommand (1)

```text
ichangerulemodelscommand_executeasync
```

### iclearcascadingformulacommand (1)

```text
iclearcascadingformulacommand_executeasync
```

### iclipboardmanager (5)

```text
iclipboardmanager_copyasync
iclipboardmanager_cutasync
iclipboardmanager_cutyamlasync
iclipboardmanager_paste
iclipboardmanager_pasteserializedcontrols
```

### iconfigurefieldsaction (1)

```text
iconfigurefieldsaction_executeasync
```

### iconfigurefieldscommand (1)

```text
iconfigurefieldscommand_executeasync
```

### icontrol (16)

```text
icontrol_addcomponentpropertyasync
icontrol_addrule
icontrol_addrulewithinstrumentation
icontrol_changeoutputtype
icontrol_changeoutputtypeasync
icontrol_changeoutputtypeusingdocumenttype
icontrol_deserializeandchangeoutputtypeasync
icontrol_removecomponentpropertyasync
icontrol_removerule
icontrol_setcomponentpropertyscoperuleasync
icontrol_tryaddpcfservicedependency
icontrol_tryrefreshrule
icontrol_tryrefreshruleasync
icontrol_unlockcontrol
icontrol_updatecomponentpropertyasync
icontrol_updatenamemapsourceasync
```

### icreaterulemodelscommand (1)

```text
icreaterulemodelscommand_executeasync
```

### idatatocontrolscreator (3)

```text
idatatocontrolscreator_createcontrolsasync
idatatocontrolscreator_createdefaultdetailscardcontrolsasync
idatatocontrolscreator_createdefaultdetailscardcontrolscore
```

### imovescreenorcomponentcommand (1)

```text
imovescreenorcomponentcommand_executeasync
```

### iprettyprintcommand (1)

```text
iprettyprintcommand_executeasync
```

### irefreshdatasourcecommand (2)

```text
irefreshdatasourcecommand_executeasync
irefreshdatasourcecommand_executemanyasync
```

### iremovechildcontrolscommand (1)

```text
iremovechildcontrolscommand_executeasync
```

### iremovewhitespacecommand (1)

```text
iremovewhitespacecommand_executeasync
```

### iresourcemanager (4)

```text
iresourcemanager_createresourceasync
iresourcemanager_createresourcefromuri
iresourcemanager_createresourcefromuriasync
iresourcemanager_removeresourceasync
```

### isearchappcommand (1)

```text
isearchappcommand_executeasync
```

### isearchappreplacecommand (1)

```text
isearchappreplacecommand_executeasync
```

### isetcascadingformulacommand (1)

```text
isetcascadingformulacommand_executeasync
```

### isetcdsviewcommand (1)

```text
isetcdsviewcommand_executeasync
```

### isetpropertyaction (1)

```text
isetpropertyaction_executeasync
```

### isetpropertycommand (1)

```text
isetpropertycommand_executeasync
```

### isetserverpropertyaction (1)

```text
isetserverpropertyaction_executeasync
```

### isetserverpropertycommand (1)

```text
isetserverpropertycommand_executeasync
```

### isetuserfeaturecommand (1)

```text
isetuserfeaturecommand_executeasync
```

### isetuserfeaturescommand (1)

```text
isetuserfeaturescommand_executeasync
```

### ismartformulagenerator (1)

```text
ismartformulagenerator_createasync
```

### itabulardatasource (1)

```text
itabulardatasource_updatemaxgetrowscountasync
```

### iupdateappcomponentdependenciescommand (1)

```text
iupdateappcomponentdependenciescommand_executeasync
```

### iupdatewizardstepactionordercommand (1)

```text
iupdatewizardstepactionordercommand_executeasync
```

### publishinfo (1)

```text
publishinfo_setbackgroundcolorstring
```

### testhooks (1)

```text
testhooks_codegenrule
```

### undomanager (2)

```text
undomanager_redo
undomanager_undo
```

