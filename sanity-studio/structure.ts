import type { StructureResolver } from 'sanity/structure';

/** Vaults first; each vault opens to its notes and attachments so a folder of .md files reads like one. */
export const structure: StructureResolver = (S) =>
  S.list()
    .title('Vault Market')
    .items([
      S.listItem()
        .title('Vaults')
        .schemaType('vault')
        .child(
          S.documentTypeList('vault')
            .title('Vaults')
            .child((vaultId) =>
              S.list()
                .title('Vault')
                .items([
                  S.listItem().title('Listing').child(S.document().schemaType('vault').documentId(vaultId)),
                  S.listItem()
                    .title('Notes')
                    .child(
                      S.documentList()
                        .title('Notes')
                        .schemaType('note')
                        .filter('_type == "note" && vault._ref == $vaultId')
                        .params({ vaultId })
                        .defaultOrdering([{ field: 'path', direction: 'asc' }])
                    ),
                  S.listItem()
                    .title('Attachments')
                    .child(
                      S.documentList()
                        .title('Attachments')
                        .schemaType('attachment')
                        .filter('_type == "attachment" && vault._ref == $vaultId')
                        .params({ vaultId })
                    ),
                ])
            )
        ),
      S.divider(),
      S.documentTypeListItem('seller').title('Sellers'),
      S.listItem()
        .title('Unattached uploads')
        .child(S.documentList().title('Notes without a vault').schemaType('note').filter('_type == "note" && !defined(vault)')),
    ]);
