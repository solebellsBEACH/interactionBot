export const SCRAP_SELECTORS = {
    jobResults: [
        'a.job-card-list__title',
        'a.job-card-container__link',
        'a[data-control-name*="job_card"]',
        'li.jobs-search-results__list-item',
        'li[data-job-id]',
        'div.jobs-search-results-list',
        'div.scaffold-layout__list-container'
    ],
    jobResultsEmpty: [
        '.jobs-search-no-results',
        '.jobs-search-no-results__container',
        '.artdeco-empty-state'
    ],
    jobResultsList: 'div.jobs-search-results-list, div.scaffold-layout__list-container',
    jobCard: 'li.jobs-search-results__list-item, .jobs-search-results__list-item, li[data-job-id], div.job-card-container',
    jobLink: 'a.job-card-list__title, a.job-card-container__link, a[data-control-name*="job_card"]',
    jobCompany: '.job-card-container__company-name, .job-card-container__primary-description',
    jobLocation: '.job-card-container__metadata-item, .job-card-container__metadata-item--location',
    jobDetailContainer: 'section.jobs-unified-top-card, .jobs-unified-top-card',
    jobDetailText: [
        '.jobs-unified-top-card__primary-description',
        '.jobs-unified-top-card__subtitle-secondary-grouping',
        '.jobs-unified-top-card__applicant-count'
    ]
}
