# Reconciliação de migrations — preflight 2026-10-14

Projeto de produção `ymbqezywautqnjhsrlit`; `main` inicial `c6432d293e0cb96d6dca8050a1cd4918c6b821f3`.
Fonte remota: `supabase_migrations.schema_migrations.statements[1]`; fonte local: arquivos SQL da `main` inicial. O histórico original é recuperável por esse commit Git.

- 72 versões remotas, 75 arquivos locais; 44 versões remotas sem timestamp local, 47 arquivos locais sem versão remota.
- 36 pares de timestamps diferentes têm MD5 idêntico do SQL completo.
- 7 pares adicionais são idênticos após remover somente a quebra de linha final do arquivo local.
- A versão remota `20260522154648` difere semanticamente do arquivo local próximo `20260522154651`: `VALUES` incondicional versus `SELECT` condicionado à existência em `auth.users`. Não são tratados como SQL equivalente.
- Quatro versões locais permanecem sem correspondente remoto (`20260522154651`, `20260522203000`, `20260522211500`, `20260603090000`); não foram marcadas `applied` sem prova.

## Ação versionada neste PR

- Renomeados somente os 43 pares cuja equivalência integral do SQL foi comprovada por MD5 (36) ou pela única quebra de linha final (7). O conteúdo operacional não foi editado.
- Incluído `20260522154648_original_admin_role.sql` para representar a versão remota. Após o primeiro teste real do Preview, a atribuição do papel admin nesse arquivo recebeu um guard de existência em `auth.users`: a produção contém o usuário e o papel, mas um Preview vazio não contém o usuário, e o `VALUES` original falha na FK `user_roles_user_id_fkey`. O SQL original da produção está preservado em `supabase_migrations.schema_migrations.statements[1]` e no commit inicial desta branch (`d9f4a34`); a divergência do arquivo local é intencional e limitada à capacidade de replay em um banco vazio. O arquivo local `20260522154651` permanece intacto e não foi tratado como equivalente.
- Nenhuma linha de `supabase_migrations.schema_migrations` foi inserida, apagada ou alterada para forçar o alinhamento. As quatro versões locais extras permanecem visíveis para o Preview avaliar; não foram marcadas como aplicadas.
- O replay inicial do Preview avançou até a migration nova e revelou seis serviços históricos de seed (UUIDs gerados, preços online em BRL), enquanto a produção tem os quatro serviços reais verificados (preços online em EUR). O backfill novo aceita somente o conjunto exato de quatro de produção ou o conjunto exato de seis do seed, mantendo falha fechada para qualquer outro baseline; serviços futuros continuam internos por padrão. Após a aplicação em produção, o arquivo foi renomeado para `20261015011143_services_public_visibility.sql`, a versão registrada pelo Supabase; o SQL permaneceu igual.
- O reset da branch Preview conservou o bucket Storage `member-documents` (vazio e com configuração idêntica à migration histórica), mas refez o banco. A migration histórica `20261007234840` falhou no `INSERT` duplicado. A única mudança nesse arquivo é `ON CONFLICT (id) DO NOTHING` para tornar o replay idempotente; não há alteração do bucket de produção nem dos dados/documentos. A exclusão direta via SQL foi recusada pela proteção do Storage e não foi contornada.

| Versão remota | Arquivo local original | MD5 remoto | Evidência |
|---|---|---|---|
| 20260522153739 | 20260522153742_91f23602-a04e-4187-8bef-b9927e878c05.sql | `b825883a589d51fa04a0cc102a4d2278` | SQL byte a byte |
| 20260522154125 | 20260522154127_fdf99399-52e1-46ec-a161-70162f50ac99.sql | `b76f03a6e9eb3cb4aac61fbe123274fe` | SQL byte a byte |
| 20260522154648 | sem par | `1e12386422fa3a025e836ae4f364cb79` | guard de replay para usuário ausente no Preview; SQL local intencionalmente diferente |
| 20260522160451 | 20260522160453_4be728fc-71f6-41cd-940e-f2c898218302.sql | `ceba0e3e045f174ce278d98f27ed2142` | SQL byte a byte |
| 20260522164515 | 20260522164519_7199fc9d-bf98-4cec-81b4-7552a2476aeb.sql | `f5052364e7b22cdaca4c18f2a41bbf4e` | SQL byte a byte |
| 20260522164724 | 20260522164727_e9acdf4c-f49e-4134-9a57-1c10c352b00a.sql | `43e8a711b16613a363a9656a15d2522d` | SQL byte a byte |
| 20260522170752 | 20260522170755_7bbde67b-c682-4fa5-bf34-d73ddd581080.sql | `6e0ddfe59e4f6c50f110ff3aa0a26ab0` | SQL byte a byte |
| 20260522172904 | 20260522172907_8d904049-5f6f-4be8-9a59-1b4a2133e5ac.sql | `09fefaf4184ed9cea563acc0226180bc` | SQL byte a byte |
| 20260522175755 | 20260522175759_a8b104b4-d33e-4c7f-9965-ee25712b0775.sql | `14d2b438aeb630f6d7110f39de9fb588` | SQL byte a byte |
| 20260522182107 | 20260522182110_f3b9822f-2037-418e-9331-1f6bd406c36a.sql | `cab410f698e01ba7ffe6f6014752c30d` | SQL byte a byte |
| 20260522185000 | 20260522185003_90122f15-c2b7-4f4b-907f-7b6011d90f5d.sql | `a0e5c0deb1a08ebfabc3dc26e6cba377` | SQL byte a byte |
| 20260522191507 | 20260522191510_5f894857-e289-409b-b2d0-6a5ff856017e.sql | `9eac01c23973278c0a47ed30a4a73cf5` | SQL byte a byte |
| 20260522214236 | 20260522223000_supabase_security_hardening.sql | `04c4fc7b5532a5fc423773bac673b965` | SQL + LF final |
| 20260522214349 | 20260522224500_restrict_public_rpc_execute.sql | `1bf9b165c4ab3d62c76a00c772b995d0` | SQL + LF final |
| 20260529232313 | 20260529232315_3c362bb4-110c-4ef1-ba2e-a507f480e9ba.sql | `33adfa800fcbee171b5f482957f13687` | SQL byte a byte |
| 20260529233501 | 20260529233505_101c49d8-ec3e-42ce-a071-4803a0bd8349.sql | `a19fce13222586173303fd4b5f7e007f` | SQL byte a byte |
| 20260530005532 | 20260530005534_574bef03-1d14-4099-9a48-ba9369e6e07f.sql | `5da31820bc957308f91145a7d84460bd` | SQL byte a byte |
| 20260601184406 | 20260601184409_ac63bf53-2d7f-45fc-a630-31c7fd0988eb.sql | `2b58e0c30dfd9e0b1a822377ca0e0883` | SQL byte a byte |
| 20260601220618 | 20260601160000_crm_module_foundation.sql | `44e27b9905c39b6827391894d653e44d` | SQL + LF final |
| 20260601223544 | 20260601192305_manual_user_first_access.sql | `e64b8cc79187cf54199e6d3a0b9e2a5a` | SQL + LF final |
| 20260602130042 | 20260602143000_pdv_sales_history_voiding.sql | `821c06377771af0fd1950d177e4352d2` | SQL + LF final |
| 20260603191113 | 20260603191115_440b5d8b-aac2-4b87-a45a-832ab54a9335.sql | `a76cbb38545df2c1dfb7a3f97afac51e` | SQL byte a byte |
| 20260603195257 | 20260603195300_a64a547b-552b-4d62-95c8-2be1bd09ad26.sql | `4b6fd6fa9da1126db250b6adc3c396e1` | SQL byte a byte |
| 20260603201424 | 20260603201427_c565d1a0-3f51-461e-8001-1a0fe3bf73d5.sql | `88a5b5b3824d0ba363e723fb70e8a3d2` | SQL byte a byte |
| 20260603232344 | 20260603232346_e958e457-9810-4314-88a1-b3ec852578d2.sql | `2e01fc65c7646ab5958a5475df095fc4` | SQL byte a byte |
| 20260604122959 | 20260604123002_0cdce246-0e18-4ce5-b6c1-d9e9fafcaa1d.sql | `cd70e4b51baf0a00dc39cbeb8d5a8dd9` | SQL byte a byte |
| 20260604132207 | 20260604132209_1592be7f-b6da-465c-8393-7b1e33167db5.sql | `7c1947d800cb8b6b44f1641c3f56732b` | SQL byte a byte |
| 20260604134457 | 20260604134500_45657955-02ce-4a1a-bdaa-e0b888891daf.sql | `2eb39cc1450de2c10c6c07d8ec7c37fc` | SQL byte a byte |
| 20260604150125 | 20260604150127_5d8dac85-d4e8-456f-a3a4-0107c7c496d1.sql | `2b7e9967eb84bfdd0b01da45a7ebafac` | SQL byte a byte |
| 20260604164413 | 20260604164415_ec557f4f-20c0-4fe0-b5fd-a8147022f042.sql | `d078a15dd8fbd055910de56f179b0afd` | SQL byte a byte |
| 20260604210129 | 20260604210132_b3419c44-52ca-4e94-a9d0-4314a8a61d55.sql | `c2b147ca4db5bedd8ad3ea26b63dd6b9` | SQL byte a byte |
| 20260604232912 | 20260604232914_0d105bea-3ba4-4931-884d-4df3cb11b676.sql | `a3d2b94a1dba0d4c4523a94aece156af` | SQL byte a byte |
| 20260607152713 | 20260607114500_harden_role_sensitive_access.sql | `44e202153d2c520bc23d67a2d13ff278` | SQL + LF final |
| 20260607152803 | 20260607115500_limit_permission_helpers_anon_access.sql | `5d1e321c26fb1afb69730e85cc14a7b0` | SQL + LF final |
| 20260608155253 | 20260608155255_92cb6580-477b-4e14-aa38-f9caebe25afc.sql | `c6f15d5dc2eedcaee6d3755741393b22` | SQL byte a byte |
| 20260608173752 | 20260608173755_27ac2734-a6d9-4543-82ed-7dbc4e4f9b30.sql | `c4e509fe0287783394c0b4cf3b8147dc` | SQL byte a byte |
| 20260608181414 | 20260608181417_b1d1dbf7-435e-4f78-9d73-bbf1f8c129a4.sql | `696a54151c536e29777fa437a9e6f9c0` | SQL byte a byte |
| 20260612145359 | 20260612145401_0c2ed5c8-c119-46f2-b584-b85007a76f64.sql | `4a96bd92e896d96add931dccc6c21322` | SQL byte a byte |
| 20260612160811 | 20260612160814_1d19ae43-0198-44f7-bda3-a392c093c912.sql | `75cb3769c811c4adc2acda45b98ae267` | SQL byte a byte |
| 20260619153855 | 20260619153858_1cf8d33f-d9a7-4df8-b124-42ea3f3af390.sql | `0b641e792a62e5c022592f35179adf1f` | SQL byte a byte |
| 20260630165707 | 20260630165710_706253b4-ceb4-479a-ad25-b4f79a851a23.sql | `5480c16383fbc2365bb1ed5570342281` | SQL byte a byte |
| 20260630171732 | 20260630171737_b29f0fd6-e6dd-4788-88a6-09f24d21b066.sql | `5b65db222e2fbf23486a5ac6e0a313bc` | SQL byte a byte |
| 20260630174223 | 20260630174229_5c887a4f-a46e-4b52-8ef2-9edfe5758144.sql | `5c0acd0a9c049a4f59cdaac1a02ef46b` | SQL byte a byte |
| 20260702184912 | 20260702184915_b0226c82-4d2f-472a-8b04-850d17daabab.sql | `55d1c21dc7d70c62cdfebd0ee3ab9600` | SQL byte a byte |

## Arquivos locais sem versão remota original

- `20260608173755_27ac2734-a6d9-4543-82ed-7dbc4e4f9b30.sql` — MD5 `c4e509fe0287783394c0b4cf3b8147dc`
- `20260522203000_stabilize_auth_roles_financial_access.sql` — MD5 `eaae5784cd1a603ee10371ae68a296d9`
- `20260630165710_706253b4-ceb4-479a-ad25-b4f79a851a23.sql` — MD5 `5480c16383fbc2365bb1ed5570342281`
- `20260522182110_f3b9822f-2037-418e-9331-1f6bd406c36a.sql` — MD5 `cab410f698e01ba7ffe6f6014752c30d`
- `20260529232315_3c362bb4-110c-4ef1-ba2e-a507f480e9ba.sql` — MD5 `33adfa800fcbee171b5f482957f13687`
- `20260522211500_harden_passport_pdv_tabs.sql` — MD5 `8b16138359b370b4705fb579e969b7b0`
- `20260604164415_ec557f4f-20c0-4fe0-b5fd-a8147022f042.sql` — MD5 `d078a15dd8fbd055910de56f179b0afd`
- `20260604132209_1592be7f-b6da-465c-8393-7b1e33167db5.sql` — MD5 `7c1947d800cb8b6b44f1641c3f56732b`
- `20260601184409_ac63bf53-2d7f-45fc-a630-31c7fd0988eb.sql` — MD5 `2b58e0c30dfd9e0b1a822377ca0e0883`
- `20260601160000_crm_module_foundation.sql` — MD5 `2f5ba10d4915a0f361d7b5fcd74acc6d`
- `20260608181417_b1d1dbf7-435e-4f78-9d73-bbf1f8c129a4.sql` — MD5 `696a54151c536e29777fa437a9e6f9c0`
- `20260604232914_0d105bea-3ba4-4931-884d-4df3cb11b676.sql` — MD5 `a3d2b94a1dba0d4c4523a94aece156af`
- `20260522223000_supabase_security_hardening.sql` — MD5 `fb41d0f39b23eff247b1d17074ca676e`
- `20260522224500_restrict_public_rpc_execute.sql` — MD5 `1c51066584db4123a56611c29ab8fbf8`
- `20260522170755_7bbde67b-c682-4fa5-bf34-d73ddd581080.sql` — MD5 `6e0ddfe59e4f6c50f110ff3aa0a26ab0`
- `20260630171737_b29f0fd6-e6dd-4788-88a6-09f24d21b066.sql` — MD5 `5b65db222e2fbf23486a5ac6e0a313bc`
- `20260522164519_7199fc9d-bf98-4cec-81b4-7552a2476aeb.sql` — MD5 `f5052364e7b22cdaca4c18f2a41bbf4e`
- `20260604134500_45657955-02ce-4a1a-bdaa-e0b888891daf.sql` — MD5 `2eb39cc1450de2c10c6c07d8ec7c37fc`
- `20260603232346_e958e457-9810-4314-88a1-b3ec852578d2.sql` — MD5 `2e01fc65c7646ab5958a5475df095fc4`
- `20260612160814_1d19ae43-0198-44f7-bda3-a392c093c912.sql` — MD5 `75cb3769c811c4adc2acda45b98ae267`
- `20260604210132_b3419c44-52ca-4e94-a9d0-4314a8a61d55.sql` — MD5 `c2b147ca4db5bedd8ad3ea26b63dd6b9`
- `20260607115500_limit_permission_helpers_anon_access.sql` — MD5 `7ea46782648e827e5f4ce3dc487e107e`
- `20260603201427_c565d1a0-3f51-461e-8001-1a0fe3bf73d5.sql` — MD5 `88a5b5b3824d0ba363e723fb70e8a3d2`
- `20260602143000_pdv_sales_history_voiding.sql` — MD5 `c0f6da946a59d481282dee3d7fdf2858`
- `20260522175759_a8b104b4-d33e-4c7f-9965-ee25712b0775.sql` — MD5 `14d2b438aeb630f6d7110f39de9fb588`
- `20260619153858_1cf8d33f-d9a7-4df8-b124-42ea3f3af390.sql` — MD5 `0b641e792a62e5c022592f35179adf1f`
- `20260603191115_440b5d8b-aac2-4b87-a45a-832ab54a9335.sql` — MD5 `a76cbb38545df2c1dfb7a3f97afac51e`
- `20260601192305_manual_user_first_access.sql` — MD5 `e51375c36d763aeea3051a582f1b25bc`
- `20260529233505_101c49d8-ec3e-42ce-a071-4803a0bd8349.sql` — MD5 `a19fce13222586173303fd4b5f7e007f`
- `20260702184915_b0226c82-4d2f-472a-8b04-850d17daabab.sql` — MD5 `55d1c21dc7d70c62cdfebd0ee3ab9600`
- `20260522172907_8d904049-5f6f-4be8-9a59-1b4a2133e5ac.sql` — MD5 `09fefaf4184ed9cea563acc0226180bc`
- `20260530005534_574bef03-1d14-4099-9a48-ba9369e6e07f.sql` — MD5 `5da31820bc957308f91145a7d84460bd`
- `20260608155255_92cb6580-477b-4e14-aa38-f9caebe25afc.sql` — MD5 `c6f15d5dc2eedcaee6d3755741393b22`
- `20260522185003_90122f15-c2b7-4f4b-907f-7b6011d90f5d.sql` — MD5 `a0e5c0deb1a08ebfabc3dc26e6cba377`
- `20260522154127_fdf99399-52e1-46ec-a161-70162f50ac99.sql` — MD5 `b76f03a6e9eb3cb4aac61fbe123274fe`
- `20260522154651_67fd7c8f-90e5-49cc-9348-ed3dcd8edbdf.sql` — MD5 `10124d259263203034f810a95cd59adb`
- `20260612145401_0c2ed5c8-c119-46f2-b584-b85007a76f64.sql` — MD5 `4a96bd92e896d96add931dccc6c21322`
- `20260522160453_4be728fc-71f6-41cd-940e-f2c898218302.sql` — MD5 `ceba0e3e045f174ce278d98f27ed2142`
- `20260522191510_5f894857-e289-409b-b2d0-6a5ff856017e.sql` — MD5 `9eac01c23973278c0a47ed30a4a73cf5`
- `20260607114500_harden_role_sensitive_access.sql` — MD5 `b44aba28cf5d4f3c4bbae8a15d712507`
- `20260603195300_a64a547b-552b-4d62-95c8-2be1bd09ad26.sql` — MD5 `4b6fd6fa9da1126db250b6adc3c396e1`
- `20260630174229_5c887a4f-a46e-4b52-8ef2-9edfe5758144.sql` — MD5 `5c0acd0a9c049a4f59cdaac1a02ef46b`
- `20260604150127_5d8dac85-d4e8-456f-a3a4-0107c7c496d1.sql` — MD5 `2b7e9967eb84bfdd0b01da45a7ebafac`
- `20260603090000_uazapi_whatsapp_integration.sql` — MD5 `b3ef0f6648969acf7f6270283adcc369`
- `20260522164727_e9acdf4c-f49e-4134-9a57-1c10c352b00a.sql` — MD5 `43e8a711b16613a363a9656a15d2522d`
- `20260522153742_91f23602-a04e-4187-8bef-b9927e878c05.sql` — MD5 `b825883a589d51fa04a0cc102a4d2278`
- `20260604123002_0cdce246-0e18-4ce5-b6c1-d9e9fafcaa1d.sql` — MD5 `cd70e4b51baf0a00dc39cbeb8d5a8dd9`

## Divergências de conteúdo ainda examinadas

- `20260602233314`: diferença apenas de formatação SQL, mesmo fluxo de tokens.
- `20260608132349`: diferença apenas de comentários/formatação SQL, mesmo fluxo de tokens.
- `20261008134100`: diferença apenas de comentários SQL, mesmo fluxo de tokens.
- `20260602165019`: comentário local adicional; comando `NOTIFY` igual.
