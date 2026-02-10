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
    jobPostedTime: [
        '.job-card-container__listed-time',
        '.job-card-container__footer-item',
        '.job-search-card__listdate',
        '.job-card-list__footer-item',
        'time'
    ],
    jobDetailContainer:
        'section.jobs-unified-top-card, .jobs-unified-top-card, .job-details-jobs-unified-top-card, .job-details-jobs-unified-top-card__container, .job-details-jobs-unified-top-card__tertiary-description-container',
    jobDetailText: [
        '.jobs-unified-top-card__primary-description',
        '.jobs-unified-top-card__subtitle-secondary-grouping',
        '.jobs-unified-top-card__applicant-count',
        '.job-details-jobs-unified-top-card__tertiary-description-container'
    ],
    jobDetailLink: [
        '.jobs-unified-top-card__title a',
        '.jobs-unified-top-card__content--two-pane a',
        'a[href*="/jobs/view/"]'
    ],
    jobDetailApplicants: [
        '.jobs-unified-top-card__applicant-count',
        '.job-details-jobs-unified-top-card__applicant-count',
        '.job-details-jobs-unified-top-card__tertiary-description-container',
        '.job-details-jobs-unified-top-card__tertiary-description-container .tvm__text',
        '.jobs-unified-top-card__subtitle-secondary-grouping .tvm__text',
        '.jobs-unified-top-card__subtitle-secondary-grouping span',
        '.jobs-unified-top-card__subtitle-secondary-grouping li',
        '.jobs-unified-top-card__subtitle-secondary-grouping'
    ],
    jobDetailPostedTime: [
        '.jobs-unified-top-card__posted-date',
        '.jobs-unified-top-card__posted-date time',
        '.job-details-jobs-unified-top-card__tertiary-description-container',
        '.job-details-jobs-unified-top-card__tertiary-description-container .tvm__text',
        '.jobs-unified-top-card__subtitle-secondary-grouping time',
        '.jobs-unified-top-card__subtitle-secondary-grouping span',
        '.job-details-jobs-unified-top-card__posted-date',
        'time'
    ]
}
